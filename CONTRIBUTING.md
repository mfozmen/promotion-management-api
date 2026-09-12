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
- [ ] Coverage checked (`npm run test:cov`)
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

## Review process

Every PR receives an advisory Claude AI review. The PR is then labelled `needs-human-check` and the repository owner is mentioned; merge happens only after the owner says so. `main` is protected: no direct pushes.

## Merge strategy

Squash merge only — one commit per PR on `main`.
