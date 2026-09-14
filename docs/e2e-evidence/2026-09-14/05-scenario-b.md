# Scenario B: a flash sale under read load

> "The second a campaign is created, it instantly affects over 50,000 products.
> During flash sales, the GET /products listing endpoint (the storefront)
> experiences massive read traffic … Develop a strategy to prevent the system from
> encountering bottlenecks during these simultaneous heavy read and write
> operations."

Real HTTP with `autocannon` against the compose stack. Catalogue ~100 000
products, ~100 000 of them in `Accessories`, containers on one host.

## The measurement that could falsify the design

The design's claim is that storefront reads are served from Redis and **do not
reach PostgreSQL**. That is falsifiable, so it is reported first.

`pg_stat_statements` is not available on this stack — it needs a preload and a
restart, and installing it would change the system being measured. `pg_stat_database`
answers the same question and is already there.

| Window                                                  | Requests served | PostgreSQL transactions |
| ------------------------------------------------------- | --------------- | ----------------------- |
| idle, 2 s                                               | 0               | **2**                   |
| `GET /api/products/:id`, 10 s at 100 connections        | **22 133**      | **8**                   |
| `GET /api/products?category=…`, 10 s at 100 connections | ~15 600         | **8**                   |

The idle stack commits about one transaction a second on its own — the reconciler's
sweep and the health checks. **The read load adds nothing above that floor.**
Twenty-two thousand product reads cost the database the same eight transactions ten
idle seconds would have. The read path does not touch PostgreSQL.

## Under the sale

A 50 % `Accessories` promotion was created three seconds into a twelve-second read
load at 100 connections, so the recompute of ~100 000 products ran against the same
stores the storefront was reading from.

|                             | req/s     | p50   | p99    | max      | non-2xx | errors | timeouts |
| --------------------------- | --------- | ----- | ------ | -------- | ------- | ------ | -------- |
| quiet                       | **1 728** | 28 ms | 48 ms  | —        | 0       | 0      | 0        |
| during the sale's recompute | **1 013** | 92 ms | 125 ms | 1 861 ms | **0**   | **0**  | **0**    |

Throughput fell by about 40 % and p99 roughly tripled while a hundred thousand
products were being re-priced and rewritten — and **not one request failed, timed
out, or returned a non-2xx**. That is the bottleneck question answered: the write
storm costs latency, not availability, and it costs it only while it runs.

The single worst request in the window was 1 861 ms. It is worth quoting because a
p99 alone hides it, and one caller did wait nearly two seconds.

The sale applied: the same listing afterwards served `1051 → 526` naming
`Accessories 50 under load`.

## A near-miss worth recording

One transaction-delta reading came back **negative** — `before=260, after=11`.
PostgreSQL's cumulative counters had been reset underneath the measurement by other
work on the same machine. The number was real, reproducible, and about nothing.

It was caught because a negative delta is impossible, not because the method was
sound. The re-measurement above took an idle sample first precisely so the floor is
visible and a reset would show up as an impossibility rather than as a small number.

## Vantage

Single machine, containers on one host, PostgreSQL 16, Redis 7, catalogue
~100 000 products. Loopback with no network between client and server, so these
latencies are a **ceiling for this machine** rather than a service level. Figures
are one run each, not a median of three; the throughput comparison is between two
runs taken minutes apart on the same stack.
