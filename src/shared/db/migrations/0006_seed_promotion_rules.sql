-- The promotion-layer policy: which of a product's candidate promotions is applied. The seeded
-- default is the lower effective price, in the customer's favour (owner decision, 2026-09-12),
-- so a 50 % category sale also covers an accessory carrying its own 5 % promotion, which is
-- what a shopper expects a sale to mean.
--
-- Four rules, not two. A json-rules-engine rule carries one event, so each outcome needs its
-- own row: "the lower price wins" is two, and a product with only one candidate is two more.
-- The arity-one pair is what lets a later rule reject a candidate outright -- a price floor, a
-- category exclusion -- and still be consulted for a product that has only one; a resolver
-- that shortcut the single-candidate case would leave such a rule present and never run,
-- which reads exactly like a rule that passed.
--
-- Each candidate is priced before the rules run, so a rule compares two outcomes and never
-- does arithmetic. The event vocabulary is `selectCandidate` with a `level` of `product` or
-- `category` and nothing else, so a rule cannot select nothing: a product with no promotion of
-- its own cannot be held out of a category sale on this vocabulary.
--
-- Priorities are distinct by contract, not by convention: json-rules-engine returns every
-- matching event and runs same-priority rules concurrently, so the resolver picks the highest
-- priority in the results rather than the first, and two rules sharing one would make the
-- winner an ordering detail. 10-30 is reserved for these; an operator override sits above 30,
-- below which `product-only` shadows it for exactly the products that have one candidate.
--
-- ON CONFLICT keeps a hand-applied re-run from creating a second copy.
INSERT INTO "pricing_rules" ("type", "name", "conditions", "event", "priority")
VALUES
  (
    'promotion',
    'product-only',
    '{"all":[{"fact":"productPriceCents","operator":"notEqual","value":null},{"fact":"categoryPriceCents","operator":"equal","value":null}]}',
    '{"type":"selectCandidate","params":{"level":"product"}}',
    30
  ),
  (
    'promotion',
    'category-only',
    '{"all":[{"fact":"productPriceCents","operator":"equal","value":null},{"fact":"categoryPriceCents","operator":"notEqual","value":null}]}',
    '{"type":"selectCandidate","params":{"level":"category"}}',
    25
  ),
  (
    'promotion',
    'lower-price-product',
    '{"all":[{"fact":"productPriceCents","operator":"notEqual","value":null},{"fact":"categoryPriceCents","operator":"notEqual","value":null},{"fact":"productPriceCents","operator":"lessThanInclusive","value":{"fact":"categoryPriceCents"}}]}',
    '{"type":"selectCandidate","params":{"level":"product"}}',
    20
  ),
  (
    'promotion',
    'lower-price-category',
    '{"all":[{"fact":"productPriceCents","operator":"notEqual","value":null},{"fact":"categoryPriceCents","operator":"notEqual","value":null},{"fact":"categoryPriceCents","operator":"lessThan","value":{"fact":"productPriceCents"}}]}',
    '{"type":"selectCandidate","params":{"level":"category"}}',
    15
  )
ON CONFLICT ("name") DO NOTHING;
