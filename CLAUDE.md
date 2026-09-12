# CLAUDE.md

Instructions for Claude Code sessions working in this repository. For the stack and how to run it, read `package.json` (dependencies and scripts), `tsconfig.json` (compiler settings), `vitest.config.ts` (test and coverage settings) and `.github/workflows/` (CI).

## Rules

- **TDD is mandatory.** Write a failing test before any implementation code. Red-green-refactor.
- **English only** — code, comments, docs, commit messages, PR descriptions.
- **Conventional Commits** for every commit (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`).
- **Never push to `main`.** All work happens on `type/short-description` branches through pull requests.
- Keep it simple: no speculative abstractions, no unused configuration, no code for requirements that don't exist yet.
- **Data lives in the database, never in code.** Pricing rules, promotions, thresholds and anything an operator would change are rows read through a query at runtime. Seeds belong with the migrations. Only tests may build rows in memory, and the story that owns a table still exercises the real query once. Land the table before the code that reads it (REVIEW.md 2b).
- Before opening a PR: run lint, typecheck, and the full test suite; all must pass. Coverage thresholds are 100 % and the pre-commit hook runs typecheck and coverage, so a commit that drops coverage is rejected. Never bypass hooks with --no-verify.
- **Before every push**, run the `e2e-tester`, `impact-analyzer` and `docs-scribe` subagents (`.claude/agents/`) on the branch, plus `architecture-critic` when the PR touches `ADR.md`, `docs/superpowers/specs/`, `src/modules/vendor/`, `src/modules/promotion/`, `src/modules/pricing/`, `src/workers/`, or carries the `scenario` label. Push only on PASS/SOUND with the docs changes committed, then apply `e2e-verified`, `impact-verified`, `docs-verified` (and `architecture-verified`) to the PR; the `local-gates` check requires the applicable set and strips all of them on every new push.
- `architecture-critic` also reviews every ADR draft or design spec before implementation starts; `docs-scribe` maintains `ADR.md`, `README.md` and `docs/ai-appendix-notes.md` (the running source for the Form 5 appendix). Update agent definitions in `.claude/agents/` whenever the system gains an endpoint, job, cache or store.
- **Hand-off, never skipped:** the moment a PR has every required check green, no unresolved review thread and all applicable agent labels, add the `needs-human-check` label and post a comment mentioning the owner that says what changed and how it was verified. A PR that is ready but unlabelled is invisible to the owner. Merge only after the owner comments their approval, and squash merge only.
- Never write the approval word in your own comments; the owner's approval comment is the merge signal and a monitor watches for it.
- Address Claude review comments before asking for the owner's check; resolve review threads once handled. Wait for the review run to finish, then fix all findings in one commit. Severity policy (same as CONTRIBUTING.md): Critical findings and REVIEW.md blocking rules are fixed in the PR; Warnings are answered and fixed in the PR when the fix is small and local, otherwise recorded as a linked issue; Suggestions are answered and adopted only when cheaper than deferring.
- Every PR body has a **Case coverage** table (template section): which case-study items (R/A/B/D codes) it delivers, in plain words the owner can verify without reading code.

- `REVIEW.md` is the review rulebook: read it before writing code and before reviewing; blocking rules are fixed before a PR is handed to the owner.
- **Feed what you learn back into `REVIEW.md`.** A review finding that would be worth making on someone else's PR next week becomes a rule, in the PR that fixes it, with the failure that produced it stated in one line. A finding that got past review means a rule is missing or its trigger is unreachable; fix the rule too (REVIEW.md 13b).

- See `README.md`, `ADR.md`, `CONTRIBUTING.md` and `Form 5_AI Appendix.docx` for project context and process. Update `Form 5_AI Appendix.docx` as you go, not at the end.
