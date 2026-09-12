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
- [ ] Commits follow Conventional Commits
- [ ] Branch named `type/short-description`
- [ ] ADR added/updated if the change affects architecture
- [ ] `e2e-tester` and `impact-analyzer` agents run locally and passed (labels `e2e-verified`, `impact-verified`)

## Required checks

All of these are required on `main`:

- `ci` — lint, typecheck, tests with 100 % coverage thresholds, SonarCloud scan
- `pr-title` — Conventional Commit PR title
- `claude-review` — advisory AI review
- `SonarCloud Code Analysis` — quality gate
- `local-gates` — passes only when the PR carries the labels of every applicable local agent: `e2e-verified`, `impact-verified` and `docs-verified` always, plus `architecture-verified` when the PR touches `ADR.md` or `docs/superpowers/specs/`, or carries the `scenario` label. Every new push strips all four, so the agents must be re-run and the labels re-applied

Pre-push local gates: run the `e2e-tester`, `impact-analyzer` and `docs-scribe` agents (`.claude/agents/`) against the branch before pushing, and `architecture-critic` as well for design or scenario PRs. Push only when every verdict is PASS (or SOUND) and the docs changes are committed, then apply the labels.

## Local agents

Four Claude Code agents live in `.claude/agents/`. They are part of the process, not optional:

| Agent                 | When it runs                                                                                         | Output                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `architecture-critic` | Before pushing a PR that touches `ADR.md`, `docs/superpowers/specs/` or carries the `scenario` label | SOUND / REVISE / REJECT, label `architecture-verified`                                           |
| `e2e-tester`          | Before every push                                                                                    | PASS / FAIL, label `e2e-verified`                                                                |
| `impact-analyzer`     | Before every push                                                                                    | PASS / FAIL, label `impact-verified`                                                             |
| `docs-scribe`         | Before every push, on the PR branch, and whenever an AI mistake is caught and fixed                  | Updates `ADR.md`, `README.md`, `docs/ai-appendix-notes.md` in the same PR, label `docs-verified` |

Agent definitions are living documents: when an endpoint, job, cache or store lands, update the relevant agent in the same PR so it knows what to test, trace or attack.

## Review process

Every PR receives an advisory Claude AI review. The PR is then labelled `needs-human-check` and the repository owner is mentioned; merge happens only after the owner says so. `main` is protected: no direct pushes.

## Merge strategy

Squash merge only — one commit per PR on `main`.
