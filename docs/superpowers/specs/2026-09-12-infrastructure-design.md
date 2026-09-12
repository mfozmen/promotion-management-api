# Infrastructure Design — promotion-management-api

Date: 2026-09-12

## Goal

Bootstrap the repository, CI, quality gates and review workflow for the ModaCo
Promotion Management API case study before any domain code is written.

## Stack (fixed by the case study)

- Node.js 22, TypeScript (strict), Express 5, npm.
- Tests: Vitest + supertest, coverage reported as lcov.
- Lint/format: ESLint (flat config, typescript-eslint) + Prettier.
- Database / ORM: decided later, in the domain design spec.

## Repository and branching

- Public repo `mfozmen/promotion-management-api`.
- `main` is protected: no direct pushes. Required checks are `ci` and
  `claude-review`. `local-gates` still runs and its labels are read at
  hand-off, but it does not block; the title job is gone. SonarCloud's own
  check is not required either:
  the scan is skipped when a pull request touches nothing Sonar reads, and a
  required check that never reports would block such a merge forever.
- Squash merge only; PR title must be a Conventional Commit (checked in CI).
  Local commits also validated by commitlint via husky.
- All code, comments, docs and commit messages in English.

## Workflows

- `ci.yml`: lint → typecheck → test with coverage → SonarCloud scan.
- `claude-review.yml`: advisory review with `anthropics/claude-code-action@v1`
  using the subscription OAuth token (`CLAUDE_CODE_OAUTH_TOKEN`). Never runs on
  forks. Posts a summary first, inline comments second.

## Development process

- TDD: failing test first, minimal implementation, refactor.
- Every change goes through a PR reviewed by Claude and approved by the owner.

## Deliverables scaffolded now

`README.md`, `ADR.md`, `AI_APPENDIX.md` (case-mandated, skeletons), `CLAUDE.md`,
`sonar-project.properties`, workflows, PR template.

## Skipped

Docker/compose (arrives with the DB decision), release automation, Dependabot.
