-- The three ingestion rules of the case study, as json-rules-engine documents. They live in
-- the database rather than in a TypeScript constant so they change without a deploy; higher
-- priority runs first, so the markup lands before the bulk discount and the commission.
-- Promotions are rows in "promotions", not rules, so no 'promotion' rule is seeded here.
INSERT INTO "pricing_rules" ("name", "type", "conditions", "event", "priority")
VALUES
  (
    'electronics category markup',
    'ingestion',
    '{"all":[{"fact":"category","operator":"equal","value":"electronics"}]}',
    '{"type":"adjustPrice","params":{"operation":"markup","basisPoints":1500}}',
    30
  ),
  (
    'bulk stock discount',
    'ingestion',
    '{"all":[{"fact":"stockQuantity","operator":"greaterThanInclusive","value":100}]}',
    '{"type":"adjustPrice","params":{"operation":"discount","basisPoints":1000}}',
    20
  ),
  (
    'vendor commission',
    'ingestion',
    '{"all":[{"fact":"vendor","operator":"equal","value":"acme"}]}',
    '{"type":"adjustPrice","params":{"operation":"markup","basisPoints":500}}',
    10
  );
