# Operating it

**Operations.** After `npm run up`, BullMQ's own dashboard is at
http://localhost:3100/admin/queues — the four queues with their counts, the dead-letter set
(`removeOnFail: false` keeps every exhausted job in BullMQ's failed set) and the controls to
retry, promote or remove a job. It is Bull Board mounted inside the api process, outside the
`/api` prefix and outside this API's error envelope, and like everything else here it is
unauthenticated.

`GET /metrics` is the other surface outside the prefix: http://localhost:3100/metrics on the api,
and `WORKER_METRICS_PORT` on each worker. It answers Prometheus's text format, carries
`prom-client`'s default process metrics plus one request histogram from `express-prom-bundle`
(`http_request_duration_seconds`, labelled by method, status and the route pattern the router
matched rather than the path that arrived), and answers `500` with an empty body if a collector
throws. The reconciler's carries three more: `queue_waiting_jobs` and `queue_failed_jobs` per
queue, read from BullMQ at scrape time, and `readmodel_drift_repairs_total`. Only that process
registers the depths, because a queue's depth is one number rather than one per reader; a depth
Redis did not answer within two seconds reads `-1`, which is not the `0` of an empty queue.
A scenario run's latency and throughput still come from `autocannon`'s own output, and Grafana is
where the shape of the run over time is visible (ADR-0011).

[`monitoring/alerts.yml`](../monitoring/alerts.yml) holds seven Prometheus rules over those numbers,
loaded by `rule_files` and listed at http://localhost:9090/alerts once `npm run up` is running: a
target that stopped answering, a failed set that is not empty, a queue backlog, the read model
drifting, the storefront answering `503`, a p99 past a provisional 300 ms bar, and a depth that has been unreadable for five minutes - `-1` is neither `> 0` nor `> 1000`, so without that last one the two queue rules would go quiet and look healthy. Each says what
to do rather than only what happened — the dead-letter one names `npm run retry-failed`. Two of
them were fired on purpose against the running stack, which is in
[`docs/e2e-evidence/2026-09-14/09-alerts.md`](../docs/e2e-evidence/2026-09-14/09-alerts.md); the
reasoning, and why the rules are a file here rather than in Grafana, is in ADR-0012.

## Retrying a failed set

`npm run retry-failed -- <queue>` puts every job in one queue's failed set back to waiting and
logs the count. The dashboard retries one job at a time, which is the right shape for one
poisoned job and the wrong one for the hundred a bad deploy leaves behind. Each job is retried at
most once per run: a retried job that fails again re-enters the set while the command is still
walking it, so a loop that stopped only when the set emptied would never stop against a consumer
that rejects everything.
