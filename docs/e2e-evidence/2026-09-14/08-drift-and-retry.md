# Drift repair and bulk retry, end to end

Run against a stack rebuilt from `main` **after** the feature merged, because a live
probe proves the image and not the branch.

## Drift repair

The boundary sweep repairs an announcement that was never published. This repairs
something the queue cannot know about at all: a write that was published,
consumed, and then lost.

**The injection was real, not simulated.** Five members were removed from the
`category:Accessories` sorted set with `ZREM`, which is what an eviction or a
partial restore leaves behind — no event was missed, so there is nothing for the
sweep to re-announce.

```
before   PostgreSQL 100 000   Redis 100 000
ZREM ×5  PostgreSQL 100 000   Redis  99 995
```

Two minutes later, unprompted, from the reconciler's own log:

```
boundary sweep complete   since 05:13:42  windowEnd 05:18:42  repaired 0
read model drift repaired category=Accessories products=100000 listed=99995 recomputed=100000
categories repaired by the drift check   repaired=1
```

`ZCARD` afterwards: **100 000**.

Three things that make this the right shape rather than merely a passing run:

- **The sweep found nothing and said so** (`repaired 0`) before the drift check
  found the loss. The two mechanisms answer different questions and the log shows
  both answering.
- **Only the affected category was rebuilt.** `Accessories` holds 100 000 of the
  catalogue's 500 330; nothing else was touched.
- **The line carries both counts**, so an operator reading it afterwards can tell
  how far apart the stores had drifted rather than only that something happened.

## Bulk retry

`npm run retry-failed -- <queue>` against the live stack:

```
{"queue":"promotions","retried":0,"msg":"failed jobs returned to waiting"}
{"queues":["promotions","products","ingestion","maintenance"],"msg":"name one queue: …"}
```

The second line is the refusal of a name that is not a queue, and the list comes
from the routing map rather than from a second list in the script.

**The mechanism itself is proved in integration rather than here, and deliberately
so.** Manufacturing a failed set in a running stack means breaking a worker on
purpose; the integration test does exactly that, with a consumer that rejects
everything, against a real BullMQ.

That test is also what found the defect: **three jobs were retried 157 times**
before the bound went in. A retried job that fails again re-enters the failed set
while the command is still walking it, so a loop that stopped when the set emptied
would never stop against a consumer that rejects everything. Each job is now
retried at most once per run, and that is the whole termination argument.

## Vantage

Single machine, containers on one host, catalogue 500 330 products with 100 000 in
`Accessories`. The drift injection and the repair are both from the live stack; the
retry command's wiring is live and its bound is from integration against a real
BullMQ.
