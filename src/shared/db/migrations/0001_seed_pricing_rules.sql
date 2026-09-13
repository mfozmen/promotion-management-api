-- The three ingestion rules of the case study (issue #9), as json-rules-engine documents. They
-- live in the database rather than in a TypeScript constant so they change without a deploy;
-- higher priority runs first, so the markup lands before the bulk discount and the commission.
-- These rows fix the event vocabulary the ingestion wrapper of #39 must compile: an
-- `adjustPercentBps` event with a signed basis-point `value`, and facts drawn from the vendor
-- row (`category`, `stockQuantity`, `vendorPriceCents`). A rule the wrapper cannot parse stops
-- the whole job by design, so the two sides have to agree exactly.
-- Only the ingestion layer is seeded; the promotion-layer rules belong to the resolver (#36).
-- ON CONFLICT keeps a hand-applied re-run from doubling a markup.
--
-- The category match is exact and case-sensitive, and `Electronics` with a capital E is issue
-- #9's spelling. That is a data decision, not a constraint: a vendor file that spells the
-- category differently needs this row edited, not the code changed.
INSERT INTO "pricing_rules" ("type", "name", "conditions", "event", "priority")
VALUES
  (
    'ingestion',
    'electronics category markup',
    '{"all":[{"fact":"category","operator":"equal","value":"Electronics"}]}',
    '{"type":"adjustPercentBps","params":{"value":1500}}',
    30
  ),
  (
    'ingestion',
    'bulk stock discount',
    '{"all":[{"fact":"stockQuantity","operator":"greaterThan","value":100}]}',
    '{"type":"adjustPercentBps","params":{"value":-300}}',
    20
  ),
  (
    -- Every row: the commission applies to the whole catalogue. A per-vendor commission would
    -- need a `vendor` fact the chunk processor does not supply, and is its own story.
    'ingestion',
    'vendor commission',
    '{"all":[{"fact":"vendorPriceCents","operator":"greaterThanInclusive","value":0}]}',
    '{"type":"adjustPercentBps","params":{"value":500}}',
    10
  )
ON CONFLICT ("name") DO NOTHING;
