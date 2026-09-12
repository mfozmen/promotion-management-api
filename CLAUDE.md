# CLAUDE.md

Instructions for Claude Code sessions working in this repository.

## Stack

Node.js 22, Express 5, TypeScript (strict), Vitest + Supertest, ESLint + Prettier, SonarCloud, GitHub Actions.

## Commands

- `npm ci` — install
- `npm run dev` — run locally
- `npm test` — run tests
- `npm run test:cov` — run tests with coverage
- `npm run lint` — lint

## Rules

- **TDD is mandatory.** Write a failing test before any implementation code. Red-green-refactor.
- **English only** — code, comments, docs, commit messages, PR descriptions.
- **Conventional Commits** for every commit (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`).
- **Never push to `main`.** All work happens on `type/short-description` branches through pull requests.
- Keep it simple: no speculative abstractions, no unused configuration, no code for requirements that don't exist yet.
- Before opening a PR: run lint, typecheck, and the full test suite; all must pass.
- See `README.md`, `ADR.md`, `CONTRIBUTING.md` and `AI_APPENDIX.md` for project context and process. Update `AI_APPENDIX.md` as you go, not at the end.
