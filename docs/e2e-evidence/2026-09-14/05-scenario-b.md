# Scenario B: a flash sale under read load

> "The second a campaign is created, it instantly affects over 50,000 products.
> During flash sales, the GET /products listing endpoint (the storefront)
> experiences massive read traffic … Develop a strategy to prevent the system from
> encountering bottlenecks during these simultaneous heavy read and write
> operations."

Real HTTP with `autocannon` against the compose stack. The sale below ran on
`Accessories` holding **100 000 products — twice the case study's 50 000**.

## The measurement that could have falsified the design

The design's claim is that storefront reads are served from Redis and **do not
reach PostgreSQL**. That is falsifiable, so it is reported first.

`pg_stat_statements` is not available on this stack — it needs a preload and a
restart, and installing it would change the system being measured.
`pg_stat_database` answers the same question and is already there.

| Window                                           | Requests served | PostgreSQL transactions |
| ------------------------------------------------ | --------------- | ----------------------- |
| idle, 2 s                                        | 0               | 2                       |
| read-only burst, 20 s                            | **34 400**      | **10** (and 217 tuples) |
| `GET /api/products/:id`, 10 s at 100 connections | 22 133          | 8                       |

Ten transactions for thirty-four thousand storefront reads — and those ten are the
readiness probe and the workers, not the reads. The idle stack commits about one a
second on its own, so **the read load adds nothing above its own floor.**

Had that delta tracked the request count, the read model would have been a cache
with a fallback and ADR-0003 would have been wrong.

## The sale, created while the load was running

|                                             | req/s     | p50   | p99    | non-2xx | errors |
| ------------------------------------------- | --------- | ----- | ------ | ------- | ------ |
| quiet baseline                              | **1 721** | 28 ms | 42 ms  | 0       | 0      |
| during the sale (77 000 requests over 60 s) | **1 280** | 32 ms | 104 ms | **0**   | **0**  |
| during the cancel                           | **1 366** | —     | 70 ms  | **0**   | **0**  |

Propagation, measured from the `201`:

|                 | first product | all 100 000 |
| --------------- | ------------- | ----------- |
| sale applied    | **915 ms**    | **12.2 s**  |
| cancel reverted | **993 ms**    | **10.6 s**  |

**The sale costs about a quarter of the throughput and doubles the tail while it
runs, and nothing once it has.** Not one request failed, timed out or returned a
non-2xx in either window.

The 205 000 tuples PostgreSQL returned during each window are the **recompute**
reading its own products a page at a time — not the storefront's reads.

A shorter run on the same stack, at 100 connections with the sale created three
seconds in, showed the same shape and a worst single request of **1 861 ms**. It is
worth quoting because a p99 hides it and one caller really did wait nearly two
seconds.

## The answer to the question as asked

The case study asks for a strategy that prevents bottlenecks under simultaneous
heavy reads and writes. Measured: **the writes never block the reads, because the
reads never reach the store the writes contend for.** What the write storm costs is
latency for as long as it runs — a quarter of the throughput, double the tail — and
it costs nothing to availability.

## A near-miss worth recording

One transaction-delta reading came back **negative** — `before=260, after=11`.
PostgreSQL's cumulative counters had been reset underneath the measurement by other
work on the same machine. The number was real, reproducible, and about nothing.

It was caught because a negative delta is impossible, not because the method was
sound. Later runs take an idle sample first, so the floor is visible and a reset
shows up as an impossibility rather than as a plausible small number.

## Vantage

Single machine, containers on one host, PostgreSQL 16, Redis 7, `Accessories`
holding 100 000 products. Loopback with no network between client and server, so
these latencies are a **ceiling for this machine** rather than a service level.
Each figure is one run, not a median of three, and the quiet and loaded runs were
taken minutes apart on the same stack.
