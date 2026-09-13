# Contributing

## Source layout

Modular monolith: one directory per module under `src/modules/`, and inside a module directories are named for a role, never for a kind of syntax (REVIEW.md 8c.7). One exported declaration per file, the file named after it (8c.2).

```
src/
  modules/<module>/
    domain/     types, interfaces, enum-like aliases and the pure rules over them; imports no store and no framework
    db/         queries and repositories (Drizzle)
    http/       routes, handlers, request schemas (zod)
    jobs/       BullMQ processors
  shared/
    db/schema/  one file per table, schema.ts re-exports
    http/       error type, error handler, request validator, logger
    config.ts
tests/
  unit/         mirrors src/, one test file per source file
  integration/  real PostgreSQL and Redis
  e2e/
```

Test files import their subject through the `@src/*` alias — `import { effectivePrice } from '@src/modules/promotion/domain/effective-price.js'` — wired in `tsconfig.json` `paths` and `vitest.workspace.ts`, which declares the alias once and spreads it into both projects (a workspace project does not inherit the root `vitest.config.ts` `resolve` block). Production code under `src/` does not use it and keeps relative specifiers: `tsc` does not rewrite path aliases on emit, so an alias in `src/` compiles to an import Node cannot resolve and fails at container start rather than at build. An ESLint `no-restricted-imports` rule scoped to `src/**/*.ts` rejects it, and `tsconfig.build.json` excludes `tests`, so nothing reaches the runtime through the alias.

A module opens a directory when it has a file for it, not before. No `models/`, `types/`, `interfaces/`, `classes/`, `utils/` or `helpers/` anywhere.

## Branch naming

`type/short-description`, e.g. `feat/product-listing`, `fix/promotion-overlap`.

## Conventional Commits

Commit messages use [Conventional Commits](https://www.conventionalcommits.org/) types:

- `feat` — a new feature
- `fix` — a bug fix
- `docs` — documentation only
- `test` — adding or correcting tests
- `refactor` — code change that neither fixes a bug nor adds a feature
- `chore` — tooling, config, dependencies
- `ci` — CI/CD configuration

## TDD cycle

1. **Red** — write a failing test that expresses the desired behavior.
2. **Green** — write the minimum code to make it pass.
3. **Refactor** — clean up while keeping tests green.

No implementation code is written before its failing test exists.

## PR checklist

- [ ] Tests written first and passing (`npm test`)
- [ ] Coverage is 100 % (`npm run test:cov`, both layers, needs `TEST_DATABASE_URL`; the required `ci` check enforces the threshold. The pre-commit hook runs `npm test`, the unit layer only, so committing needs no database)
- [ ] Lint passes (`npm run lint`)
- [ ] No open SonarCloud finding on the PR, read from SonarCloud's PR comment (an ignore needs the owner's approval and a reasoned entry in `sonar-project.properties`)
- [ ] Commits follow Conventional Commits
- [ ] Branch named `type/short-description`
- [ ] ADR added/updated if the change affects architecture
- [ ] The agents this change needs ran locally and passed, and their labels are on the PR. `local-gates` prints the set it computed from the changed paths; that is the authority

## Required checks

Required on `main`:

- `ci` — lint, typecheck, schema-drift check (`db:generate`, asserted on its success line because it exits 0 on failure, then `git add -AN` and `git diff --exit-code` over `src/shared/db/migrations`), tests with 100 % coverage thresholds, SonarCloud scan
- `claude-review` — advisory AI review

`local-gates` also runs on every pull request but does not block a merge. It computes the agent labels this diff needs from its changed paths and prints the set: `docs-verified` always, `cases-verified` when the pull request touches `src/`, `impact-verified` for the behaviour or judgement group below, and `architecture-verified` when it touches `ADR.md`, `docs/superpowers/specs/`, the Scenario A and B modules or `src/workers/`, or carries the `scenario` label. `e2e-verified` is never required; that run happens when the owner asks for it. Every new push strips all five, so the applicable agents are re-run and their labels re-applied before the pull request goes to the owner.

`local-gates` still runs and computes the agent set from the changed paths, and
its labels are read at hand-off, but it does not block a merge. The SonarCloud
check is not required either: the scan is skipped when a pull request touches
nothing it reads, and a required check that never reports would block such a
merge forever. The pull request title job has been removed.

`local-gates` lists the pull request files and edits labels with the workflow's `GITHUB_TOKEN`; both are served by the `pull-requests` and `issues` scopes, and the job performs no checkout, so it grants no `contents` scope. A `403` on that step means the pull request comes from a fork, where the token is read-only regardless of the `permissions` block. Fork pull requests cannot pass this gate (nor the Claude review); open the branch in this repository instead.

Pre-push local gates: run the agents the change needs against the branch before pushing, then apply their labels. Which ones are needed follows from what the diff can break, not from the fact that a diff exists. The changed paths fall into two groups:

- **Behaviour** — changes how the running application or its build behaves: `src/`, `tests/`, `scripts/`, `.claude/agents/`, `package.json`, a `*.config.ts`, `*.config.mjs` or `*.config.js`, a `tsconfig*.json`, a `Dockerfile` or a compose file (`docker-compose.yml`, `compose.yaml`).
- **Judgement** — changes how the work itself is judged: `.github/workflows/`, `.claude/agents/`, `.husky/`, `sonar-project.properties`.

An agent definition is in both groups: the agent itself must be exercised, and every branch in flight is judged by it. Push only when every applicable verdict is PASS (or SOUND) and the docs changes are committed.

## Local agents

Four Claude Code agents live in `.claude/agents/`. They are part of the process, not optional:

| Agent                 | When it runs                                                                                                                                                 | Output                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `architecture-critic` | Before pushing a PR that touches `ADR.md`, `docs/superpowers/specs/`, the vendor, promotion or pricing modules, the workers, or carries the `scenario` label | SOUND / REVISE / REJECT, label `architecture-verified`                                           |
| `e2e-tester`          | When the owner asks for a run; never a required label                                                                                                        | PASS / FAIL, label `e2e-verified`                                                                |
| `impact-analyzer`     | Before pushing a PR that touches the **behaviour** or the **judgement** group                                                                                | PASS / FAIL, label `impact-verified`                                                             |
| `test-case-generator` | Before pushing a PR that touches `src/`; reads the story's acceptance criteria, never the implementation                                                     | PASS / FAIL, writes `docs/e2e-cases/<issue>.md`, label `cases-verified`                          |
| `docs-scribe`         | Before every push, on the PR branch, and whenever an AI mistake is caught and fixed (this one always applies)                                                | Updates `ADR.md`, `README.md`, `docs/ai-appendix-notes.md` in the same PR, label `docs-verified` |

Agent definitions are living documents: when an endpoint, job, cache or store lands, update the relevant agent in the same PR so it knows what to test, trace or attack.

## Stacked pull requests

Stacked pull requests are a GitHub feature in public preview, driven by the official `gh stack` extension (`gh extension install github/gh-stack`; see the [documentation](https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests)). Install it before using the commands below.

Two pull requests that touch the same file are not independent, even when their content is: merging one forces conflict resolution in the other. Before opening a branch, compare its expected file list with the open pull requests. On any overlap, branch from that pull request's branch, open the new one against it (`gh pr create --base <branch>`) and register the stack (`gh stack link <lower PR> <new branch>`). GitHub retargets the upper pull requests automatically as the lower ones merge.

Never merge `main` into a branch that is part of a stack; the merge commit breaks the cascading rebase. Use `gh stack sync`. To merge only the bottom pull request of a stack, use the [asynchronous merge endpoint](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request-asynchronously) (`gh api -X PUT repos/OWNER/REPO/pulls/N/merge-async -f merge_method=squash`), which merges every pull request up to and including that one; `gh stack merge` is atomic over the whole stack and the ordinary merge endpoints refuse a stacked pull request. This was used to merge #22 while #23 was still open.

## Review rules

Severity policy for review findings, from any reviewer:

- **Critical**, and any violation of a REVIEW.md rule marked blocking: fixed before the owner is asked to check.
- **Warning**: answered on the thread and fixed in the pull request that found it, then resolved. A finding that genuinely belongs to another branch is routed to that branch; nothing is filed as an issue to be dealt with later, because a filed warning is not progress — it moves the work sideways and makes the pull request look cleaner than it is.
- **Suggestion**: answered and resolved; adopted only when it is cheaper to do than to defer.
- Findings are collected until the review run has finished, then fixed in one commit. Pushing while a review is in flight cancels it and restarts the whole cycle.

`REVIEW.md` lists the rules every review enforces (money and time exactness, database-enforced invariants, race conditions, serverless constraints, storefront reads Redis only, high-traffic hygiene, TDD and coverage, errors, size, hygiene) with severities. Blocking findings are fixed before the owner is asked to check.

## Review process

Every PR receives an advisory Claude AI review. When all required checks pass, no review thread is left unresolved and the applicable agent labels are on the PR, it is labelled `needs-human-check` and the repository owner is mentioned in a comment summarising what changed and how it was verified. Merge happens only after the owner posts their approval. `main` is protected: no direct pushes.

Definition of done for a PR hand-off:

1. `ci` and `claude-review` are green on the final commit.
2. Every review thread is answered and resolved.
3. `docs-verified` and, where the paths call for it, `impact-verified` and `architecture-verified` are present. `e2e-verified` appears only after a run the owner asked for.
4. `needs-human-check` is added and the owner is mentioned.

## Merge strategy

Squash merge only — one commit per PR on `main`.
