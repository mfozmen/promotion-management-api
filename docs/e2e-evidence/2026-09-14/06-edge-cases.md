# Edge cases

Reasoned from the mechanisms rather than from the code, then run live against the
compose stack.

## A promotion whose whole window is shorter than the sweep interval

The reconciler sweeps every five minutes. A promotion that opens and closes inside
that window is invisible to it, so the delayed boundary jobs are the only thing
that can apply and retire it.

A 60-second window, watched at five-second intervals from outside:

```
03:13:41  10000  no promotion      <- before the window
03:13:56   5000  "Blink …"         <- 4 s after startsAt
03:14:57  10000  no promotion      <- 5 s after endsAt
```

**Both boundaries fired within five seconds of their instant, and the reconciler
never touched it.** The sweep is the repair for a lost announcement, not the
mechanism, and this is the difference showing.

## Promotion validation and conflict

| Probe                                      | Result                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------ |
| 100 % percentage discount                  | refused `409` — another promotion already covered that target and window |
| zero-value discount                        | `400`                                                                    |
| promotion on a product that does not exist | **`404 No such product`**                                                |
| `endsAt` before `startsAt`                 | `400`                                                                    |
| a window entirely in the past              | `400`                                                                    |
| percentage above 100                       | `400`                                                                    |

The `404` is worth naming: a foreign-key violation reaches the caller as "no such
product" rather than as a `500` or a driver message.

## Product validation

| Probe                   | Result                                           |
| ----------------------- | ------------------------------------------------ |
| duplicate SKU on create | **`409 A product with this SKU already exists`** |
| negative base price     | `400`                                            |

## Storefront validation

Refused with the envelope: an unknown query field, `pageSize` outside 1-100,
`sort` other than `effectivePrice`, an `order` that is not `asc`/`desc`, a
257-character category, a negative or non-numeric page, and an offset past 10 000
(`page=501` at `pageSize=20` is the inclusive boundary; `502` is refused).

Path parameter: `0`, `-1`, `abc`, `1.5` and `1 OR 1=1` all `400`; a well-formed id
that does not exist is `404`. **A malformed id never reaches the `bigint` column.**

## Ingestion

- **CRLF line endings, a quoted comma inside a field, and no trailing newline** all
  parse correctly.
- **A duplicate SKU inside one file** is deduped before the upsert, because
  `ON CONFLICT DO UPDATE` cannot affect the same row twice in one statement. The
  last row wins. But `rowsProcessed` counts distinct SKUs rather than rows read, so
  three data rows report `rowsProcessed: 2, rowsRejected: 0` and **the vendor's
  arithmetic does not close**. Folding them into `rejected` would be a different
  wrong number — a row that lost to a later row was not rejected. A third counter
  is the honest fix. Recorded, not taken.
- **A category move through re-import** leaves the old listing: `CatOne` 1 → 0,
  `CatTwo` 0 → 1. There is no product update endpoint (`PATCH` is `404`), so a
  category move is reachable only through ingestion.

## Vantage

Single machine, containers on one host. Functional results; the only timing here is
the boundary-job latency, observed at five-second polling resolution, so "4 s" and
"5 s" are upper bounds rather than measurements.
