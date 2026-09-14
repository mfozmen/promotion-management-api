# Tests and checks

Tests and checks. The whole integration layer runs against the `test` profile's own PostgreSQL and Redis, never the ones `api` and the workers use: the queue and shutdown tests obliterate the queues they touch, and the layer clones a database per test file. `npm run up` starts both, and neither holds anything worth keeping.

```bash
npm test
npm run test:cov # needs both test stores, see below
npm run lint
```

`npm run dev` starts the API on `PORT` (default `3100`); `GET http://localhost:3100/api/health` should answer `{"status":"ok"}`. Read its logs on the terminal: under `tsx watch` a redirect such as `npm run dev > out.log` swallows them, so use `npx tsx src/server.ts > out.log` when you need them in a file.

The suite is split into layers, so the one that needs nothing can run anywhere:

| Layer                              | Command                    | Needs                                                                                    | Runs                        |
| ---------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- | --------------------------- |
| unit (`tests/unit/`)               | `npm test`                 | nothing                                                                                  | pre-commit hook, everywhere |
| integration (`tests/integration/`) | `npm run test:integration` | the `test` profile's PostgreSQL on 55432 and Redis on 6399, both started by `npm run up` | CI, before every push       |
| both, with coverage                | `npm run test:cov`         | the same two                                                                             | CI (the 100 % gate)         |

The integration tests run against a real PostgreSQL and a real Redis, never a mock. The defaults name
the `test` profile's two stores — `TEST_DATABASE_URL`
`postgres://postgres:postgres@127.0.0.1:55432/promotion` and `TEST_REDIS_URL`
`redis://127.0.0.1:6399/9` — so after `npm run up` the suite needs no override; CI sets both
explicitly against its own services. The queue and shutdown tests read a third variable,
`QUEUE_TEST_REDIS_URL` (default `redis://127.0.0.1:6399`, the same store), which names the server and
no logical database: those two files select the indexes in code, because what they exercise is the
read-model/queue split itself. CI leaves it at that default. Each host is `127.0.0.1` rather than `localhost` because Node
resolves `localhost` to `::1` first and compose publishes IPv4 only. Pointing
`TEST_DATABASE_URL` at the application's own server
(`postgres://promo:promo@127.0.0.1:5432/promotion`) works and puts the clones in the
`postgres-data` volume you are developing against.

The integration project's `globalSetup` applies `src/shared/db/migrations/*.sql` to a template
database once; each test file then clones that template, so files stay isolated and can run in
parallel. The template is named after the checkout and clones carry a timestamp, so several
worktrees can share one server without dropping each other's databases. Run one integration
suite per worktree at a time, though: the template is rebuilt at the start of each run, so two
runs in the same checkout would pull it out from under each other. Regenerate the
migrations with `npm run db:generate` after changing a module's `db/schema/`, and apply
them to a running database with `DATABASE_URL=... npm run db:migrate` (drizzle-kit reads
`DATABASE_URL`, not `TEST_DATABASE_URL`, and falls back to
`postgres://postgres:postgres@localhost:5432/promotion` when it is unset, which is not the
compose server's role). CI's "No schema drift" step runs `npm run db:generate < /dev/null`,
checks the tool's own success line, then `git add -AN src/shared/db/migrations` and
`git diff --exit-code src/shared/db/migrations`, so a schema change committed without its
migration fails the build. It reads the success line rather than the exit code because
`drizzle-kit generate` exits 0 even when it fails and writes nothing; `git add -AN` is what
makes an untracked new migration visible to the diff (ADR-0003).
