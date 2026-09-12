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
- Before opening a PR: run lint, typecheck, and the full test suite; all must pass. Coverage thresholds are 100 % and the pre-commit hook runs typecheck and coverage, so a commit that drops coverage is rejected. Never bypass hooks with --no-verify.
- **Before every push**, run the `e2e-tester` and `impact-analyzer` subagents (`.claude/agents/`) on the branch. Push only on PASS, then apply the `e2e-verified` and `impact-verified` labels to the PR; the `local-gates` check requires them and strips them on every new push.
- Run `architecture-critic` on every ADR draft or design spec before implementing it, and `docs-scribe` after every merge (it maintains `ADR.md`, `README.md` and `docs/ai-appendix-notes.md`, the running source for the Form 5 appendix). Update agent definitions in `.claude/agents/` whenever the system gains an endpoint, job, cache or store.
- After checks pass, label the PR `needs-human-check`, mention the owner, and wait for their go-ahead before merging. Squash merge only.
- Address Claude review comments before asking for the owner's check; resolve review threads once handled.
- See `README.md`, `ADR.md`, `CONTRIBUTING.md` and `Form 5_AI Appendix.docx` for project context and process. Update `Form 5_AI Appendix.docx` as you go, not at the end.
