# Recovery, resumability and read load

Real HTTP and real containers against the compose stack. Nothing here is from the
test suite.

## Recovery when the read-model consumer is down

Stopped `event-handler`, cancelled a promotion, restarted it.

| Step                                  | Storefront                                           |
| ------------------------------------- | ---------------------------------------------------- |
| promotion live                        | 15 000 cents, naming the sale                        |
| consumer stopped, promotion cancelled | **still 15 000, still naming a cancelled promotion** |
| consumer restarted                    | **30 000, no promotion**, unprompted                 |

Stale while the consumer is down is correct — the announcement was queued and
undelivered, not lost. The queue is what makes the recovery automatic.

## Recovery when the announcement is genuinely lost

Same setup, then `DEL bull:promotions:wait` while the consumer was down, so only
the reconciler's boundary sweep can repair it.

**The repair did not arrive within a reconciler period, and the reason is worth
more than the fact.** The sweep is running on schedule and repairing nothing:

```
since 2026-09-13T20:43  windowEnd 2026-09-13T21:43  repaired 0  "boundary sweep complete"
```

while wall time is **03:07 on the 14th**. The watermark was seeded when the
database was migrated, and the sweep advances it by at most an hour per run
(`MAX_WINDOW_SECONDS`). At a five-minute schedule that is twelve hours of history
per wall-clock hour, so the window reaches a cancellation made now roughly half an
hour later.

This is the hour clamp working exactly as ADR-0007 specifies — the clamp exists so
a long outage cannot be read in one unbounded statement — but the **observable
consequence belongs in the evidence rather than in a trade-off paragraph**: on a
database whose watermark is behind, a lost announcement is repaired _after the
watermark reaches it_, not within one reconciler period. "Converges without
operator action" is true; "within five minutes" is not, until the watermark has
caught up.

## Resumability under a kill (Scenario A's serverless constraint)

`SIGKILL` to the ingestion worker after two of six chunks, with the third
checkpointed at 1 000 rows:

- the killed chunk returned with **attempts 2 and 87 783 rows** — that chunk's
  total, **not** 1 000 + 87 783;
- the six chunks sum to **exactly 500 000**;
- 500 000 products carry the job.

Had the resumed attempt restarted its chunk from the beginning, the sum would have
read 501 000. **The arithmetic is the proof**, and it would have been visibly wrong
the other way.

`docker kill` is an operator stop, so `restart: unless-stopped` correctly did not
restart the container; it was started by hand as a crash restart would.

## Where the memory floor actually is

The same 100 000-row import on a throwaway worker against the same queue and
stores:

| Container | V8 heap cap | Result                                                         |
| --------- | ----------- | -------------------------------------------------------------- |
| 96 MiB    | 64 MiB      | completed, 22-23 MB heap used                                  |
| 48 MiB    | 32 MiB      | completed in 11 s                                              |
| 32 MiB    | 24 MiB      | **OOM-killed at startup**, exit 137, before claiming any chunk |

**What fails first is the Node runtime's own footprint, not the batch.** The floor
is between 32 and 48 MiB, so the import path runs in **under a quarter of the
256 MiB the case study allows**.

And it failed _safely_: with no worker able to start, the job stayed `running` with
both chunks pending at zero attempts and nothing stored, and a normally sized
worker later completed the same import with all 100 000 rows, unprompted. **No job
reported success having stored nothing.**

## Read load, quiet stack

Catalogue ~100 000 products, containers on one host, no write traffic.

| Endpoint                                             | Connections | req/s     | p50   | p99   | non-2xx | errors |
| ---------------------------------------------------- | ----------- | --------- | ----- | ----- | ------- | ------ |
| `GET /api/products?category=Accessories&pageSize=20` | 50          | **1 728** | 28 ms | 48 ms | 0       | 0      |
| `GET /api/products/:id`                              | 100         | **4 375** | 22 ms | 35 ms | 0       | 0      |

The detail endpoint — which the case study calls "the most highly trafficked
endpoint in the system" — is the faster of the two under twice the concurrency: it
is a single hash read where the listing is a sorted-set range plus a multi-get.

## Two places where recovery needs an operator today

1. **A watermark behind wall time delays every boundary repair** until it catches
   up (above).
2. **A chunk that exhausts its attempts stays `running` with an expired lease** and
   nothing reclaims it; the vendor is then refused by the one-import-per-vendor
   index. Observed on its own during the memory runs, not arranged. The
   orphan-chunk sweep that would reclaim it does not exist yet.

## Vantage

Single machine, containers on one host, PostgreSQL 16, catalogue ~100 000 products.
Container accounting for memory, never host RSS. Latencies are loopback with no
network between client and server, so they are a **ceiling** for this machine
rather than a service level.
