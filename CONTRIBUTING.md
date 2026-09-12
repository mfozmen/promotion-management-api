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
- `local-gates` — passes only when the PR carries both `e2e-verified` and `impact-verified` labels; every new push strips them, so the two agents must be re-run and the labels re-applied

Pre-push local gates: run the `e2e-tester` and `impact-analyzer` agents (`.claude/agents/`) against the branch before pushing. Push only when both report PASS, then apply the labels.

## Local agents

Four Claude Code agents live in `.claude/agents/`. They are part of the process, not optional:

| Agent                 | When it runs                                                          | Output                                                     |
| --------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------- |
| `architecture-critic` | On every ADR draft or design spec, and before a scenario PR is opened | SOUND / REVISE / REJECT verdict                            |
| `e2e-tester`          | Before every push                                                     | PASS / FAIL, label `e2e-verified`                          |
| `impact-analyzer`     | Before every push                                                     | PASS / FAIL, label `impact-verified`                       |
| `docs-scribe`         | After every merge, and whenever an AI mistake is caught and fixed     | Updates `ADR.md`, `README.md`, `docs/ai-appendix-notes.md` |

Agent definitions are living documents: when an endpoint, job, cache or store lands, update the relevant agent in the same PR so it knows what to test, trace or attack.

## Review rules

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
