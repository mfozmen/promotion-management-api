# The API

All endpoints are mounted under the `/api` prefix (ADR-0009). JSON bodies are capped at 100 kB and validated strictly: an unknown field is a `400`, never a silently dropped one, and that `400` can answer any route. The vendor upload is the exception — it is multipart, so it never reaches the JSON parser and carries its own size cap and its own `415`.

The endpoint table is in the [README](../README.md); operating surfaces outside the `/api`
prefix - Bull Board, `/metrics`, the alert rules - are in [operations](./operations.md).

`GET /api/products` takes `category` (exact match, optional, 256 characters), `sort=effectivePrice` (the only sort), `order=asc|desc` (default `asc`), `page` (default 1) and `pageSize` (1-100, default 20); the resulting offset may not exceed 10 000. `GET /api/products/:id` takes an id of digits only.

`GET /api/promotions` takes five optional query parameters, combined with `AND`. Three are filters: `status` (`draft`, `active` or `cancelled`), `category` (exact match) and `productId`. Two page the result: `limit` (a positive integer, default `50`, maximum `100`) and `after`, a keyset cursor holding the last `id` of the previous page. The list is ordered by `id` and the response is `{ "items": [...] }` with no cursor of its own — the caller reads the last id it received, and a page shorter than `limit` is the end. Keyset rather than `OFFSET`, because `id` never changes, so a promotion created mid-read cannot make a page repeat or skip a row. There is no sort parameter: the storefront listing that needs one is a separate endpoint. Filtering on the derived `state` is deliberately absent: that is a predicate on `now()`, and time predicates are PostgreSQL's.

Every promotion response carries both `status`, the value an admin set (`draft`, `active`, `cancelled`), and `state`, what the promotion is doing right now (`draft`, `scheduled`, `live`, `expired`, `cancelled`). `state` is computed by PostgreSQL in every read and in every write's `returning` clause (one `sql` fragment in `src/modules/promotion/db/promotion-repository.ts`), never derived in TypeScript, so no Node clock can drift against it (ADR-0004).

The overlap `409` is raised from SQLSTATE `23P01` — the two GiST exclusion constraints on `promotions` firing — and names no promotion: the envelope carries a message and nothing else. An admin refused one finds the blocker with `GET /api/promotions` filtered by `productId` or `category`.

An id that is not a positive integer answers `400`, the same as the storefront's: it is a malformed request rather than a promotion that does not exist. A `productId` no product owns answers `404`.

### Conventions

- **Errors.** Every failure returns `{ "error": { "message": "..." } }`, and the status is what a client branches on. A 4xx carries the message its raiser wrote; a 5xx carries `Internal server error` unless the raiser marked it readable, which is `http-errors`' own `expose` rather than a rule of ours (ADR-0009).
- **An unexpected error** — anything the `http-errors` library does not recognise — answers `500` with `Internal server error` and nothing else; the stack goes to the log under `err` and never to the response (ADR-0010).
- **Validation.** Request bodies, query strings and path parameters are validated at the boundary with strict zod schemas: an unknown field is a `400`, not a silently ignored typo. The rejection names the failing part and nothing more (`Invalid request body`): no field path, no issue list, no echo of what you sent. Strictness is top-level; a nested object declares its own with `z.strictObject(...)` (ADR-0009).
- **Request bodies** are capped at 100kb. Everything body-parser refuses keeps the status that says which failure it was — 400 for a body that cannot be read, 413 for one over the cap, 415 for a charset it will not decode. The 413 and 415 carry body-parser's own message, which describes the caller's own request; the 400 for unparsable JSON does not — it answers `Invalid JSON body`, because body-parser's message quotes the offending bytes and the parser's position back at the caller. The quoted detail goes to the log under `reason` (ADR-0009).
- **Storefront reads.** Both product routes are served from the Redis read model and never from PostgreSQL, so they answer `503` with a `Retry-After` in two cases: until a rebuild has published `readmodel:ready`, and whenever Redis is unreachable. A product the detail route cannot find is a `404`; a rebuild is required never to leave a listed product without its entry, so the route does not spend a command per miss asking. `page` and `pageSize` are bounded together: the resulting offset may not exceed 10 000.
- **Correlation id.** Send `x-request-id` (matching `^[A-Za-z0-9._-]{1,128}$`) to trace a request; anything else is replaced by a generated uuid. The id used is returned in the `x-request-id` response header and appears as `reqId` on every JSON log line (ADR-0010).
