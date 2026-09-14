# Ingestion: Scenario A through the HTTP route

Real HTTP against the compose stack. The 500 000-row run below was taken by the
review session; the edge cases were taken separately. Nothing here came from the
test suite.

## Scenario A, the whole sentence

> "500,000 rows … every record must pass through internal dynamic pricing rules …
> strict Timeout limit … memory is highly restricted … the processor halts as soon
> as the HTTP request completes (Stateless)."

`POST /api/vendor/imports` with a 22 MB, 500 000-row file:

|               |                                                                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Response      | `202 { jobId, chunksTotal }` in **834 ms**, including streaming 22 MB to disk and hashing it                                       |
| Chunks        | 6, each completed on its **first attempt**                                                                                         |
| Rows          | 500 000 processed, **0 rejected**                                                                                                  |
| Worker memory | **47.9 MiB at start, 51.6-54.9 MiB from the first chunk to the sixth**, against a 256 MiB container limit and a 192 MiB V8 ceiling |

**Flat is the property, not the peak.** A file six times larger draws the same
line, because what is resident is one batch rather than one file. That is the
answer to "memory is highly restricted", and the request returning in 834 ms while
six chunks run afterwards is the answer to "the processor halts as soon as the HTTP
request completes".

**99 999 rows were skipped by the `is distinct from` guard** because they were
byte-identical to an earlier import — the guard proving itself on a number nobody
arranged.

## Two durations that measure two different systems

The repository has **29 s** on record for a 500 000-row import. This run took
**128 s**. The machine is not the difference.

- **29 s** is the importer alone, with nothing consuming the announcements.
- **128 s** is the whole system keeping its read model current: every batch the
  importer announces is re-priced against the same PostgreSQL while the next chunk
  is being read. The read-model consumer peaked at **154.8 MiB** doing it.

Both are true. Neither may be quoted without saying which one it is.

## Edge cases

**A hostile CSV** — CRLF line endings, a quoted comma inside a field, no trailing
newline, and the same SKU twice — answered `202` and completed. The line endings,
the quoted comma and the missing final newline were all handled correctly.

**One counting gap, and it is in the mechanism rather than the parser.** Three data
rows produced `rowsProcessed: 2, rowsRejected: 0`. `ON CONFLICT DO UPDATE` cannot
affect the same row twice in one statement, so a duplicate SKU inside a batch is
deduped before the upsert and `rowsProcessed` is the count of distinct SKUs
returned, not rows read. The vendor's arithmetic therefore does not close, and
nothing names the difference.

Folding those rows into `rowsRejected` would be a different wrong number: **a row
that lost to a later row for the same SKU was not rejected.** The honest fix is a
third counter. Recorded, not taken.

**A product changing category through a re-import leaves the old listing.**
`MOVE-X` imported into `CatOne` (total 1), re-imported into `CatTwo`: `CatOne`
total 0, `CatTwo` total 1. Sorted-set membership follows the move. There is no
product update endpoint — `PATCH /api/products/:id` is `404` — so a category move
is reachable only through ingestion.

## Findings carried from the uniqueness model

- **One vendor can permanently refuse another vendor's file.** `file_sha256` is
  unique globally rather than per vendor, so byte-identical files collide across
  vendors and the second is refused for ever. ADR-0005 records `unique (vendor,
file_sha256)` as the fix and names the key's scope as the owner's to set.
- **`products.sku` is globally unique with no vendor column**, so a later import
  overwrites another vendor's rows for the same SKU.

Neither is an endpoint defect; both are the uniqueness model.

## Vantage

Single machine, containers on one host, PostgreSQL 16. Container accounting for
memory (not host RSS). Durations are wall time for the whole system unless the
line says otherwise.
