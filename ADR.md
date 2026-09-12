# Architecture Decision Records

This document records the significant architectural decisions made for the ModaCo Promotion Management API. Each ADR captures the context that prompted the decision, the decision itself, and its consequences and trade-offs, so future contributors understand not just what was decided but why.

---

## ADR-0001: Node.js, Express and TypeScript

**Status:** Accepted — mandated by the case study

### Context

The case study specifies the implementation stack: Node.js, Express, and TypeScript. No alternative runtime or framework evaluation is required or expected.

### Decision

Build the API on Node.js 22 (current LTS-track version), using Express 5 as the HTTP framework, with TypeScript in strict mode for all source code.

### Consequences

- Express 5 brings native support for async route handlers (unhandled rejections are forwarded to error middleware automatically), simplifying error handling compared to Express 4.
- TypeScript strict mode catches null/undefined and type-mismatch bugs at compile time, at the cost of more upfront type annotation work.
- The ecosystem (middleware, testing tools, ORMs) for Node/Express/TypeScript is mature and well-documented, reducing integration risk.
- Because the stack is mandated rather than chosen, there is no trade-off analysis against alternatives (e.g. Fastify, NestJS) — that discussion is out of scope.

---

## ADR-0002: Test-driven development with Vitest

**Status:** Accepted

### Context

The case study requires a TDD workflow. A test runner and assertion/mocking toolkit compatible with TypeScript and Express (via Supertest for HTTP-level tests) is needed, with fast feedback loops given the red-green-refactor cycle will run continuously during development.

### Decision

Use Vitest as the test runner, paired with Supertest for HTTP integration tests against the Express app. Every feature and bug fix starts with a failing test written before the implementation.

### Consequences

- Vitest's native TypeScript/ESM support avoids extra transpilation configuration and its watch mode gives sub-second feedback, which is important for a strict red-green-refactor cycle.
- Supertest lets integration tests exercise the Express app in-process (no network binding required), keeping the hottest endpoints (e.g. single product detail) testable at both unit and HTTP-contract level.
- Coverage reporting (`npm run test:cov`) feeds the SonarCloud quality gate.
- TDD discipline slows down initial feature authoring in exchange for a regression-resistant codebase and living documentation of behavior via tests — this is treated as a net win for a codebase reviewed by AI and humans on every PR.

---

## ADR-0003: Database and ORM

**Status:** Proposed — to be completed

### Question to answer

Which database and, if any, ORM/query builder will back products and promotions? The decision must account for: the relational shape of products/promotions/categories, the need to compute an "effective price" (base price adjusted by an active promotion) efficiently for sorting and pagination, and the write/read patterns of Scenario A (bulk vendor ingestion) and Scenario B (flash sales with heavy read traffic).

---

## ADR-0004: Promotion resolution and effective price

**Status:** Proposed — to be completed

### Question to answer

How is the single active promotion for a product resolved when promotions can be assigned at the product level or the category level, and how is the resulting "effective price" computed and kept consistent with the constraint of at most one active promotion per product? This must also define how a new product added to a category with an active promotion automatically inherits it (Scenario B).

---

## ADR-0005: Bulk ingestion under serverless constraints (Scenario A)

**Status:** Proposed — to be completed

### Question to answer

How are vendor files of 500k+ rows ingested and reconciled with dynamic pricing rules at the application layer, given a serverless consumption plan with a strict execution timeout, low memory ceiling, and no in-process state carried between invocations?

---

## ADR-0006: Read scaling for flash sales (Scenario B)

**Status:** Proposed — to be completed

### Question to answer

How does the system serve heavy `GET /products` read traffic and apply a promotion to 50k+ products instantly during a flash sale, without degrading the single-product-detail hot path or violating the at-most-one-active-promotion-per-product constraint?
