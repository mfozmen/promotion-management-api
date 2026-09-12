-- The three ingestion rules of the case study, as json-rules-engine documents. They live in
-- the database rather than in a TypeScript constant so they change without a deploy; higher
-- priority runs first, so the markup lands before the bulk discount and the commission.
-- Only the ingestion layer is seeded; the promotion-layer rules belong to the resolver (#36).
-- ON CONFLICT keeps a hand-applied re-run from doubling a markup (REVIEW.md 11.1).
INSERT INTO "pricing_rules" ("type", "name", "conditions", "event", "priority")
VALUES
  (
    'ingestion',
    'electronics category markup',
    '{"all":[{"fact":"category","operator":"equal","value":"electronics"}]}',
    '{"type":"adjustPrice","params":{"operation":"markup","basisPoints":1500}}',
    30
  ),
  (
    'ingestion',
    'bulk stock discount',
    '{"all":[{"fact":"stockQuantity","operator":"greaterThanInclusive","value":100}]}',
    '{"type":"adjustPrice","params":{"operation":"discount","basisPoints":1000}}',
    20
  ),
  (
    'ingestion',
    'vendor commission',
    '{"all":[{"fact":"vendor","operator":"equal","value":"acme"}]}',
    '{"type":"adjustPrice","params":{"operation":"markup","basisPoints":500}}',
    10
  )
ON CONFLICT ("name") DO NOTHING;
