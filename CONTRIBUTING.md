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
- [ ] No unresolved SonarCloud issue (an ignore needs the owner's approval and a reasoned entry in `sonar-project.properties`)
- [ ] Commits follow Conventional Commits
- [ ] Branch named `type/short-description`
- [ ] ADR added/updated if the change affects architecture
- [ ] `e2e-tester`, `impact-analyzer` and `docs-scribe` agents run locally and passed (labels `e2e-verified`, `impact-verified`, `docs-verified`); `architecture-critic` too for design or scenario PRs (`architecture-verified`)

## Required checks

All of these are required on `main`:

- `ci` — lint, typecheck, tests with 100 % coverage thresholds, SonarCloud scan, and a step that fails the build on any unresolved SonarCloud issue on the pull request
- `pr-title` — Conventional Commit PR title
- `claude-review` — advisory AI review
- `SonarCloud Code Analysis` — quality gate
- `local-gates` — passes only when the PR carries the labels of every applicable local agent: `e2e-verified`, `impact-verified` and `docs-verified` always, plus `architecture-verified` when the PR touches `ADR.md`, `docs/superpowers/specs/`, the Scenario A and B modules (`src/modules/vendor/`, `src/modules/promotion/`, `src/modules/pricing/`) or `src/workers/`, or carries the `scenario` label. Every new push strips all four, so the agents must be re-run and the labels re-applied

A SonarCloud finding blocks the merge. The `ci` job fails while any issue raised on the pull request is unresolved, whatever its severity, so the fix is to fix it. Silencing one is the exception: it needs the repository owner's explicit approval and an entry in `sonar.issue.ignore.multicriteria` in `sonar-project.properties` whose comment names the rule, the scope and why the rule does not apply there. Never widen an existing scope to cover a new finding; add an approved entry instead.

`local-gates` lists the pull request files and edits labels with the workflow's `GITHUB_TOKEN`; both are served by the `pull-requests` and `issues` scopes, and the job performs no checkout, so it grants no `contents` scope. A `403` on that step means the pull request comes from a fork, where the token is read-only regardless of the `permissions` block. Fork pull requests cannot pass this gate (nor the Claude review); open the branch in this repository instead.

Pre-push local gates: run the `e2e-tester`, `impact-analyzer` and `docs-scribe` agents (`.claude/agents/`) against the branch before pushing, and `architecture-critic` as well for design or scenario PRs. Push only when every verdict is PASS (or SOUND) and the docs changes are committed, then apply the labels.

## Local agents

Four Claude Code agents live in `.claude/agents/`. They are part of the process, not optional:

| Agent                 | When it runs                                                                                                                                                 | Output                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `architecture-critic` | Before pushing a PR that touches `ADR.md`, `docs/superpowers/specs/`, the vendor, promotion or pricing modules, the workers, or carries the `scenario` label | SOUND / REVISE / REJECT, label `architecture-verified`                                           |
| `e2e-tester`          | Before every push                                                                                                                                            | PASS / FAIL, label `e2e-verified`                                                                |
| `impact-analyzer`     | Before every push                                                                                                                                            | PASS / FAIL, label `impact-verified`                                                             |
| `docs-scribe`         | Before every push, on the PR branch, and whenever an AI mistake is caught and fixed                                                                          | Updates `ADR.md`, `README.md`, `docs/ai-appendix-notes.md` in the same PR, label `docs-verified` |

Agent definitions are living documents: when an endpoint, job, cache or store lands, update the relevant agent in the same PR so it knows what to test, trace or attack.

## Stacked pull requests

Stacked pull requests are a GitHub feature in public preview, driven by the official `gh stack` extension (`gh extension install github/gh-stack`; see the [documentation](https://docs.github.com/en/pull-requests/how-tos/stacked-pull-requests)). Install it before using the commands below.

Two pull requests that touch the same file are not independent, even when their content is: merging one forces conflict resolution in the other. Before opening a branch, compare its expected file list with the open pull requests. On any overlap, branch from that pull request's branch, open the new one against it (`gh pr create --base <branch>`) and register the stack (`gh stack link <lower PR> <new branch>`). GitHub retargets the upper pull requests automatically as the lower ones merge.

Never merge `main` into a branch that is part of a stack; the merge commit breaks the cascading rebase. Use `gh stack sync`. To merge only the bottom pull request of a stack, use the [asynchronous merge endpoint](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request-asynchronously) (`gh api -X PUT repos/OWNER/REPO/pulls/N/merge-async -f merge_method=squash`), which merges every pull request up to and including that one; `gh stack merge` is atomic over the whole stack and the ordinary merge endpoints refuse a stacked pull request. This was used to merge #22 while #23 was still open.

## Review rules

Severity policy for review findings, from any reviewer:

- **Critical**, and any violation of a REVIEW.md rule marked blocking: fixed before the owner is asked to check.
- **Warning**: answered on the thread; fixed in the same PR when the fix is small and local, otherwise recorded as an issue that the reply links, then resolved.
- **Suggestion**: answered and resolved; adopted only when it is cheaper to do than to defer.
- Findings are collected until the review run has finished, then fixed in one commit. Pushing while a review is in flight cancels it and restarts the whole cycle.

`REVIEW.md` lists the rules every review enforces (money and time exactness, database-enforced invariants, race conditions, serverless constraints, storefront reads Redis only, high-traffic hygiene, TDD and coverage, errors, size, hygiene) with severities. Blocking findings are fixed before the owner is asked to check.

## Review process

Every PR receives an advisory Claude AI review. When all required checks pass, no review thread is left unresolved and the applicable agent labels are on the PR, it is labelled `needs-human-check` and the repository owner is mentioned in a comment summarising what changed and how it was verified. Merge happens only after the owner posts their approval. `main` is protected: no direct pushes.

Definition of done for a PR hand-off:

1. `ci`, `pr-title`, `claude-review`, `SonarCloud Code Analysis` and `local-gates` are green on the final commit.
2. Every review thread is answered and resolved.
3. `e2e-verified`, `impact-verified`, `docs-verified` are present, plus `architecture-verified` for design or scenario PRs.
4. `needs-human-check` is added and the owner is mentioned.

## Merge strategy

Squash merge only — one commit per PR on `main`.
