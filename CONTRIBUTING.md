# Contributing

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
- [ ] Coverage is 100 % (`npm run test:cov`; the pre-commit hook enforces the threshold, so a commit below 100 % is rejected)
- [ ] Lint passes (`npm run lint`)
- [ ] No open SonarCloud finding on the PR, read from SonarCloud's PR comment (an ignore needs the owner's approval and a reasoned entry in `sonar-project.properties`)
- [ ] Commits follow Conventional Commits
- [ ] Branch named `type/short-description`
- [ ] ADR added/updated if the change affects architecture
- [ ] The agents this change needs ran locally and passed, and their labels are on the PR. `local-gates` prints the set it computed from the changed paths; that is the authority

## Required checks

All of these are required on `main`:

- `ci` — lint, typecheck, tests with 100 % coverage thresholds, and the SonarCloud scan, which waits for the quality gate (`sonar.qualitygate.wait`), so a gate failure fails `ci`
- `pr-title` — Conventional Commit PR title
- `claude-review` — advisory AI review
- `local-gates` — passes only when the PR carries the labels of every applicable local agent: `docs-verified` always, `e2e-verified` for the behaviour group below, `impact-verified` for the behaviour or the judgement group, plus `architecture-verified` when the PR touches `ADR.md`, `docs/superpowers/specs/`, the Scenario A and B modules (`src/modules/vendor/`, `src/modules/promotion/`, `src/modules/pricing/`) or `src/workers/`, or carries the `scenario` label. The job prints the set it computed. Every new push strips all four, so the applicable agents must be re-run and their labels re-applied

The scan runs only when the pull request touches something SonarCloud reads: the sources, the tests, a build or tool configuration, or `sonar-project.properties`. A pull request that changes only documentation or a workflow skips it, because the analysis would be a copy of the previous one. A push to `main` always scans. For that reason the required check is `ci`, which carries the scan, rather than SonarCloud's own check, which cannot report on a pull request it never analysed. The scan step carries `SONAR_TOKEN` because uploading an analysis is a write; nothing reads results back, so no other step needs it.

A SonarCloud finding is fixed before the PR is handed to the owner — a rule (REVIEW.md 13.6), not a check. Read the findings in SonarCloud's own pull request comment, or through the _Details_ link on the SonarCloud check, whatever their severity, and count an unreviewed security hotspot as one — Sonar way already fails the gate on those (`new_security_hotspots_reviewed < 100`), so they turn `ci` red as well. `impact-analyzer` reads that comment on every pre-push round and fails on an open finding, so this is checked before the hand-off rather than at merge time.

It is a rule and not a check on purpose. The free plan's quality gate judges ratings, coverage, duplication and hotspot review, so a CRITICAL code smell passes it, and a gate condition on issue count needs a custom gate, which SonarCloud asks to be paid for on this project's plan. The owner reported that from the SonarCloud interface on PR #56, which is the only place it can be seen; no API answers it. PR #56 built a CI step that queried SonarCloud's issue API instead, reviewed it twice, then deleted it: it restated what the pull request comment already says. Read that entry in `docs/ai-appendix-notes.md` before rebuilding it.

Silencing a finding needs the repository owner's explicit approval and an entry in `sonar.issue.ignore.multicriteria` in `sonar-project.properties` whose comment names the rule, the scope and why the rule does not apply there. Never widen an existing scope to cover a new finding; add an approved entry instead. Accepting, won't-fixing or false-positiving a finding in the SonarCloud web interface is not that exception — nothing mechanical stops it, which is exactly why the silencing has to come back into the repository as an approved entry, and why a finding that vanishes without a matching repository change gets asked about.

The scan is not a finding when SonarCloud is slow: a `ci` failure whose Sonar step reports a timeout (`sonar.qualitygate.timeout`, 300 s) is a re-run, not something to fix.

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
| `e2e-tester`          | Before pushing a PR that touches the **behaviour** group                                                                                                     | PASS / FAIL, label `e2e-verified`                                                                |
| `impact-analyzer`     | Before pushing a PR that touches the **behaviour** or the **judgement** group                                                                                | PASS / FAIL, label `impact-verified`                                                             |
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

1. `ci`, `pr-title`, `claude-review` and `local-gates` are green on the final commit.
2. Every review thread is answered and resolved.
3. `e2e-verified`, `impact-verified`, `docs-verified` are present, plus `architecture-verified` for design or scenario PRs.
4. `needs-human-check` is added and the owner is mentioned.

## Merge strategy

Squash merge only — one commit per PR on `main`.
