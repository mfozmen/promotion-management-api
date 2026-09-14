# The vendor sends the weekly file

Persona: the vendor (case study, Scenario A: "weekly large files … from
vendors"). ModaCo staff appear where the case study says "internal dynamic
pricing rules" and "your system".

## S1 Hand over the file once

As a vendor, I want to hand over my weekly file of 500,000 rows in one
submission, so that ModaCo's catalogue carries my products and prices without
me splitting the file or sending it twice.

Acceptance criteria

- The file is accepted in one request and I get an identifier I can ask about.
- I can see whether the import is still running, finished, or failed.
- When it finishes, every row of the file is in the catalogue.
- A file I have already sent is not imported a second time; I am refused, and the refusal
  tells me nothing about an import that may not be mine. Issue #15 asked for the first
  import's identifier and the owner reversed it: `file_sha256` is unique across all vendors
  and no caller is authenticated, so the import collided with is often another vendor's
  (ADR-0005 for the key's scope, ADR-0009 for the envelope that carries no identifier).

Test cases

### vendor-1

- Precondition: `POST /api/vendor/imports`, `GET /api/vendor/imports/:id`
- Given: a well-formed vendor file of 500,000 rows
- When: the vendor uploads it once and polls the status until it is no longer running
- Then: the status ends as finished, and the catalogue holds exactly one product per SKU in the file with the file's name, category and stock
- Measure: rows landed equals rows in the file, exact, not approximate; and the worker's own
  `heapUsed` stays flat from the first chunk to the last rather than climbing with the file.
  Recorded on this build, inside the `ingestion-worker` container at its 256 MiB and 0.5 CPU
  limits: 500 000 products over six chunks with none rejected; the container's accounting peaked
  at 49.9 MiB of 256 MiB (19.5 %), and V8's heap inside it read 25, 22, 22, 22, 22, 18 MB under a
  192 MB ceiling.

### vendor-2

- Precondition: `POST /api/vendor/imports`
- Given: next week's file from the same vendor, carrying the same SKUs with some prices changed
- When: the second import finishes
- Then: no SKU exists twice; changed prices are updated, unchanged rows are unchanged
- Measure: product count after the second import equals the count after the first

### vendor-3

- Precondition: `POST /api/vendor/imports`
- Given: a file where a handful of rows are malformed
- When: the import finishes
- Then: the well-formed rows are in the catalogue, the malformed ones are reported with their line numbers, and the import does not stop at the first bad row
- Measure: none

### vendor-10

- Precondition: `POST /api/vendor/imports`
- Given: a file the vendor has already uploaded, whose import is registered
- When: the vendor uploads the identical file again
- Then: the vendor is refused as a duplicate, no second import starts, the catalogue is
  unchanged, and the refusal identifies no import — the vendor learns nothing about one that
  may not be theirs
- Measure: none

## S2 Every row goes through ModaCo's pricing rules

As ModaCo staff, I want every vendor row priced by our own dynamic pricing
rules before it is saved, so that a vendor's raw price never reaches the
catalogue.

Acceptance criteria

- A stored base price is the vendor price after the active rules, never the vendor price itself when a rule applies.
- The rules live in ModaCo's system and change without a vendor knowing.
- A file cannot be imported with no rules to apply.
- A row that no active rule touches is stored at the vendor's price, unchanged (issue #9).

Test cases

### vendor-4

- Precondition: `POST /api/vendor/imports`, the pricing rules table with the seeded rules
- Given: the seeded rules (a category markup, a stock-based discount, a commission) and a row with category Electronics, vendor price 800.00 and stock 150
- When: the row is imported
- Then: its stored base price is 937.02, which is 800.00 marked up 15 %, discounted 3 % for stock above 100, plus 5 % commission
- Measure: none

### vendor-5

- Precondition: the pricing rules table
- Given: every ingestion rule deactivated
- When: a vendor uploads a file
- Then: the import is refused and no row is stored at the vendor's price
- Measure: none

### vendor-9

- Precondition: `POST /api/vendor/imports`, the pricing rules table
- Given: exactly one active ingestion rule, a 15 % markup on category Electronics, and a file with one row in category Home at vendor price 800.00 and stock 10
- When: the import finishes
- Then: the Home row's stored base price is 800.00, the vendor's own price, and the vendor is not told the import failed
- Measure: none

## S3 The import survives the serverless plan

As ModaCo staff, I want the import to finish on a serverless plan, so that a
timeout, a memory cap or a halted process never leaves the file half-imported
and never stores a row twice.

Acceptance criteria

- No single unit of work runs longer than the plan's timeout.
- Memory stays under the plan's cap for the whole file.
- If the processor is killed at any moment, the import resumes and finishes with the same result as an uninterrupted run.

Test cases

### vendor-6

- Precondition: the ingestion worker, `GET /api/vendor/imports/:id`
- Given: the 500,000-row file mid-import
- When: the worker process is killed twice at arbitrary moments and restarted each time
- Then: the import finishes, every SKU appears once, and the result is identical to an uninterrupted run
- Measure: three runs; product count and a checksum over (SKU, base price) equal across all three

### vendor-7

- Precondition: the ingestion worker
- Given: the 500,000-row file
- When: it is imported with the worker's memory sampled every two seconds
- Then: peak resident memory stays under the plan's cap
- Measure: peak memory across three runs, each under the 256 MiB the case study sets; the median is the reported number. Record which accounting produced it — `docker stats`' container figure is what the limit applies to, and a host `ps` RSS for the same run is a different quantity that has been mistaken for it

### vendor-8

- Precondition: the ingestion worker
- Given: the 500,000-row file
- When: it is imported
- Then: no unit of work exceeds the timeout budget
- Measure: the longest unit across three runs, under the configured budget, with the budget stated in the report
