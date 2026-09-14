# Failure injection

Each of these was produced by breaking the running stack, not by simulating it.

## Two promotions racing for one product

Eight concurrent promotion writes on the same product, fired together:
**one `201` and seven `409`**, one active row, the storefront serving the winner.

The exclusion constraint decides it inside PostgreSQL, which is why eight
simultaneous writers cannot produce two active promotions. No application lock is
involved and none would help.

## Redis restarted mid-recompute — pass

A 50 % sale on `Outerwear`'s 100 002 products, Redis restarted three seconds in.

Across the window: **70 × `200`, 13 × `503`** — about six and a half seconds of
honest unavailability saying the read model cannot be reached. **No stale price and
no fallback to PostgreSQL.** The api and the consumer stayed up, and afterwards all
100 002 products carry the sale with the queue drained.

Unavailable rather than wrong, and self-correcting. That is what the storefront's
`503` is for.

## The reconciler's schedule survived a real Redis restart

The same restart hit the reconciler, which logged:

```
[ioredis] Unhandled error event: Error: connect ECONNREFUSED 172.23.0.3:6379
{"since":"2026-09-14T00:43","windowEnd":"2026-09-14T01:43","repaired":2,"msg":"boundary sweep complete"}
```

The process stayed up and **the next sweep fired on schedule**. BullMQ upserts the
next repeatable iteration when a worker picks a job up and, on failure, emits
`error` and returns rather than throwing — so the five-minute chain could have died
silently with the container still reading as healthy. It did not.

## PostgreSQL restarted mid-recompute — the one defect

The recompute itself survived perfectly: BullMQ retried the pages whose worker had
gone and **100 001 of 100 001 products came back** after recovery.

**But the api process died and Docker restarted it.** `RestartCount` went to 1 on
both the api and the consumer, and what they printed on the way out was a raw
`terminating connection due to administrator command` stack from `pg-protocol`,
outside the logger.

`createPool` attached no `error` listener, and node-postgres documents that an idle
client emitting an error with no listener takes the process down. So **a database
restart took the HTTP listener with it, and the storefront reads that never touch
PostgreSQL failed for its duration** — the design's central claim failing in the one
place it can, through an unhandled event rather than through a query.

The read-model Redis client had the same gap without the fatality, printing outside
pino.

**Fixed in PR #128**, using each library's own documented remedy. Both tests emit
the event and assert the log line rather than the survival, because a test
asserting the process still runs passes whether or not the listener exists.

## The two uniqueness consequences, confirmed

Neither is an endpoint defect; both are the missing vendor column.

- **One vendor's import silently replaces another's product.** `acme-corp`
  imported a SKU as a jacket at 105.00 with stock 5; `globex-inc` imported the same
  SKU as a parka at 262.50 with stock 99. **There is one row and it is Globex's.**
  Acme's name, price and stock are gone, with no error to either party and nothing
  in the response saying a replacement happened.
- **A third party can lock a vendor out permanently.** A file byte-identical to
  Acme's first one, sent by anyone, gets `409 already registered` — the
  `file_sha256` index is global and nothing releases a hash. With no
  authentication, holding a competitor's catalogue file is enough.

ADR-0005 records `unique (vendor, file_sha256)` as the fix for both and names the
key's scope as the owner's to set.

## Vantage

Single machine, containers on one host. Restart timings are as observed from
outside; the `503` window is the count of refused requests during a load run rather
than a stopwatch.
