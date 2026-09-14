# Alert rules, fired on purpose

Six rules in `monitoring/alerts.yml`, loaded by Prometheus at
`http://localhost:9090/alerts` once `npm run up` is running. **A rule that has
never fired is indistinguishable from a system that is never in trouble**, so each
one below was made to fire against the running stack.

## Loaded, and reading real series

```
TargetDown            inactive
DeadLetterGrowing     inactive
QueueBacklog          inactive
ReadModelDrifting     inactive
StorefrontUnavailable inactive
StorefrontSlow        inactive
```

`queue_failed_jobs` and `queue_waiting_jobs` each return **four series**, one per
queue; `readmodel_drift_repairs_total` returns one. Nothing in the file names a
metric no process exports, and a unit test pins that — **verified by mutation**,
because the first version of that test could not fail: it looped an empty list, and
its regex carried two literal backspace characters where the word-boundary escape
belonged.

## TargetDown, fired by stopping a worker

```
06:15:51  docker stop ingestion-worker
06:16:04  inactive
06:16:16  pending   (1 alert)
06:16:41  pending
06:16:53  firing    "ingestion-worker stopped answering its scrape"
```

Restarted: **alerts back to 0** within 45 s. The `for: 30s` is what makes a restart
not page anyone, and it is visible in the pending window above.

## ReadModelDrifting, fired by real drift

Seven members removed from `category:Accessories` with `ZREM` — what an eviction or
a partial restore leaves, with **no event for the boundary sweep to re-announce**.

```
06:17:58  ZCARD 100 000 -> 99 993
06:19:59  ReadModelDrifting firing
```

`ZCARD` afterwards: **100 000**. The reconciler repaired it, the counter moved, the
rule saw the counter move. Two minutes end to end, most of it the five-minute sweep
schedule.

## What the simulation caught

The first firing summary read:

> The reconciler rebuilt **1.005081968451019** categories it found drifted

`increase()` extrapolates over the window, so its value is not a whole number of
anything. A reader would have taken that as a broken counter. The summary no longer
quotes it and the description says why; the count itself lives on
`readmodel_drift_repairs_total`.

**That is the argument for firing them rather than writing them.** The rule was
correct, the metric was correct, and the sentence a human would have been paged
with was wrong.

## The three not fired here

- **DeadLetterGrowing** (`for: 2m`) and **QueueBacklog** (`for: 5m`) need a
  poisoned consumer or a backlog sustained past the window; the mechanism they read
  is covered by the queue-depth test, and the dead-letter path itself by the bulk
  retry work.
- **StorefrontUnavailable** was observed, not staged: during the Redis restart the
  storefront answered 13 × `503` across about six and a half seconds — below the
  rule's 5 % over 2 m, which is the rule declining to page for a self-correcting
  blip, correctly.

## Vantage

Single machine, containers on one host, `scrape_interval` 5 s and
`evaluation_interval` 15 s, so every transition above is observed at a resolution
of roughly one evaluation.
