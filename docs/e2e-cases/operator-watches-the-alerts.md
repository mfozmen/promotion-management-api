# The operator watches the alerts

Persona: the operator on call — the person the rules in `monitoring/alerts.yml`
page. The case study does not name this persona; the owner asked for these cases
on 2026-09-14 so the alerting is exercised rather than only loaded, and the
README's table records that decision.

These cases are **not** a unit test of the rule file. `tests/unit/docs/prometheus-targets.test.ts`
already proves the rules load and name metrics something emits. What a test
cannot prove is that a rule fires when the thing it watches actually happens, and
that the sentence a human is paged with is true — the first firing of
`ReadModelDrifting` carried `1.005081968451019 categories` in its summary, from a
rule that was correct reading a metric that was correct.

Every case here breaks something on a running stack and watches Prometheus at
`http://localhost:9090/alerts`. **A rule that has never fired is
indistinguishable from a system that is never in trouble.**

## S17 A process that stops answering pages someone

As the operator, I want to be told when a worker or the API stops answering its
scrape, so that I learn a process is gone from an alert rather than from a
customer.

Acceptance criteria

- A stopped process raises `TargetDown` naming the service, within one evaluation of the `for: 30s` window elapsing.
- A process that restarts inside the window does not page anyone.
- The alert clears on its own once the process returns.

Test cases

### alerts-1

- Precondition: `npm run up` with the `monitoring` profile, all targets `up` at `/targets`
- Given: every target reporting, no alert firing
- When: the ingestion worker is stopped with `docker stop`, left down past 30 s, then started again
- Then: the alert goes `inactive` → `pending` → `firing` with the service named in the summary, and returns to 0 firing after the restart
- Measure: seconds from stop to `firing` and from restart to clear, both reported with the `scrape_interval` and `evaluation_interval` they were observed at

### alerts-2

- Given: every target reporting
- When: the same worker is restarted in one action, so it is absent for less than the `for: 30s` window
- Then: the rule reaches `pending` at most, and nobody is paged
- Measure: the longest absence that did **not** page, which is what the 30 s is buying

## S18 Silent divergence between the two stores is not silent

As the operator, I want to know when Redis and PostgreSQL disagreed about the
catalogue, so that a repair that happened automatically still reaches a human —
the repair is automatic, the cause is not.

Acceptance criteria

- Drift that no event describes — an eviction, a partial restore, a write lost after being consumed — raises `ReadModelDrifting` after the reconciler repairs it.
- The alert's own text is true: no quantity in it can be read as a count of categories when it is not one.
- The read model is correct again afterwards, and only the affected category was rebuilt.

Test cases

### alerts-3

- Precondition: a seeded catalogue with a category whose size is known on both sides, the reconciler running
- Given: `ZCARD category:<name>` equal to the PostgreSQL count for that category
- When: members are removed from the sorted set with `ZREM`, leaving no event for the boundary sweep to re-announce, and the stack is left alone for one sweep interval
- Then: the reconciler logs the repair with both counts, `readmodel_drift_repairs_total` moves, `ReadModelDrifting` fires, and `ZCARD` is back to the PostgreSQL count
- Measure: time from the injection to `firing`, and the count of categories rebuilt taken from the counter — never from the alert's `$value`, which `increase()` extrapolates

### alerts-4

- Given: the firing alert from alerts-3
- When: its summary and description are read as an on-call person would read them
- Then: every number shown is a number that means what the sentence says it means, and the one that does not survive is not shown
- Measure: none — this case is a reading, and it is here because it is the one that failed

## S19 A failed job is not left for someone to notice

As the operator, I want the dead-letter set to page me while it is still small,
so that a poisoned deploy is found before a hundred imports are sitting in it.

Acceptance criteria

- Any job in a queue's failed set raises `DeadLetterGrowing` once it has been there past the `for: 2m` window, with the queue named.
- The alert says what to do about it, and the command it names exists and works.
- Clearing the failed set clears the alert without a restart.

Test cases

### alerts-5

- Precondition: `queue_failed_jobs` returning one series per queue on `/metrics`
- Given: an empty failed set on every queue
- When: a job is made to fail past its `attempts` — a vendor file whose rows the consumer rejects — and left for two minutes
- Then: `DeadLetterGrowing` fires naming that queue and the job count, and Bull Board shows the same job
- Measure: the count in the alert against the count in Bull Board; they are the same number read two ways, and a disagreement is the finding

### alerts-6

- Given: the firing alert from alerts-5
- When: the command in the alert's description is run — `npm run retry-failed -- <queue>` — after the cause is fixed
- Then: the log line reports how many were returned to waiting, the failed set empties, and the alert clears on the next evaluations
- Measure: jobs retried, and seconds from the retry to the alert clearing

## S20 A backlog that is work is told apart from a backlog that is stuck

As the operator, I want a queue that is merely busy not to page me, and a queue
whose consumer has stopped to page me, so that the 500,000-row import does not
train me to ignore the alert.

Acceptance criteria

- A 500,000-row import's normal backlog does not raise `QueueBacklog`, because it drains inside the `for: 5m` window.
- A backlog sustained past the window — a stopped or stuck consumer — does raise it.
- The depth the rule reads is the same depth Bull Board shows.

Test cases

### alerts-7

- Precondition: the ingestion worker running at its 256 MiB / 0.5 CPU limit
- Given: an idle stack
- When: a 500,000-row vendor file is imported end to end with nothing else changed
- Then: `queue_waiting_jobs` rises and falls, and `QueueBacklog` does not fire
- Measure: the peak waiting depth and how long it stayed above 1000, reported against the rule's 5 m window — if the peak never approaches the threshold, that is a finding against the threshold and not a pass

### alerts-8

- Given: the same import
- When: the consumer is stopped mid-import and left stopped past five minutes
- Then: `QueueBacklog` fires naming the queue, and `TargetDown` fires for the same process — two rules describing one failure, which is the intended shape
- Measure: waiting depth at the moment of firing, from the alert and from Bull Board

## S21 A storefront that is down or slow is visible without a dashboard

As the operator, I want the shopper's experience to page me, so that "the shop
is broken" does not first reach me from the shop.

Acceptance criteria

- A sustained share of `503` answers above 5 % raises `StorefrontUnavailable`.
- A short self-correcting blip does **not** raise it, and that is the rule working rather than the rule missing something.
- p99 above the recorded bar for five minutes raises `StorefrontSlow`, whose threshold is provisional and must be replaced by a measured one from somewhere that is not a laptop.

Test cases

### alerts-9

- Precondition: the storefront answering `200`, `/api/ready` reporting both stores up
- Given: steady read traffic
- When: Redis is restarted underneath it
- Then: the storefront answers `503` while it is away, recovers on its own, and — if the `503` share stays under 5 % over two minutes — the rule does not page: the observed run was 13 `503`s over about six and a half seconds
- Measure: count and duration of the `503` window, and whether the rule fired; both outcomes are reportable, and which one happened must be stated rather than assumed

### alerts-10

- Given: the same stack under read load
- When: a flash sale's recompute runs against 50,000 products while the load continues
- Then: p99 is recorded, and whether `StorefrontSlow` fires is recorded with it
- Measure: p99 during the recompute against the rule's 300 ms bar and against S13's own measure — the two are the same number and must be changed together when a real run replaces it

## Vantage

Every case above is observed at a resolution of roughly one evaluation:
`scrape_interval` 5 s, `evaluation_interval` 15 s, containers on one host. A
transition reported to the second is not claiming a precision the stack has.
