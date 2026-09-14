# Storefront contract, probed live

Run against the compose stack on `127.0.0.1:3100`, built from `main` with the
monitoring profile up. Every figure below came from a real HTTP request; nothing
here is from the test suite.

Catalogue at the time of the run: **100 304 products**, 20 000 of them in
`Accessories`.

## The case study's three core expectations

> "List products (Must include filtering by category, pagination, and sorting by
> effective price)."

| Probe                                        | Result                                                           |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `?sort=effectivePrice&order=asc&pageSize=3`  | `200`, cheapest first — 1051, 1051, 1051 cents                   |
| `?sort=effectivePrice&order=desc&pageSize=3` | `200`, dearest first — 93 702 cents (`LIVE-*`, the markup chain) |
| `?category=Accessories`                      | `200`, `total` 20 000, every item in the category                |
| `?page=1` vs `?page=2` at `pageSize=2`       | disjoint id sets, `page` echoed                                  |
| `GET /api/products/:id`                      | `200` with `effectivePriceCents` and `promotion`                 |

**Sorting is by the effective price, not the base price** — confirmed separately by
the review session on a controlled pair: Alpha at 100.00 and Bravo at 200.00 with a
60 % promotion on Bravo alone sorts **Bravo first ascending** at 8 000 against
Alpha's 10 000. The dearer product sorts first because the shopper pays less for it.

## Validation edges

Every one of these answered `400` with the project's error envelope rather than a
stack trace or a silent default:

`page=502&pageSize=20` (offset 10 020, over the 10 000 cap) · `pageSize=101` ·
`pageSize=0` · `sort=basePrice` (the only sort is `effectivePrice`) ·
`order=sideways` · a 257-character `category` · `page=-1` · `page=abc` ·
`unknown=1` (an unknown query field is refused rather than dropped).

`page=501&pageSize=20` — offset exactly 10 000 — answers `200`. The boundary is
inclusive and the refusal starts one page later.

Path parameter: `0`, `-1`, `abc`, `1.5` and `1 OR 1=1` all answer `400`;
`99999999` answers `404`. A malformed id never reaches the `bigint` column.

## Scenario B's functional sentence

> "if a brand new product is added to the 'Accessories' category while the flash
> sale is active, that product must automatically benefit from the discount"

Verified through the real queues, not in process: with a 50 % category sale
running, `POST /api/products` created a product at 300.00 and the storefront served
it at **150.00 naming the sale 444 ms later**, with no further request.

The same listing shows the resolver's precedence in the live system: a product
carrying its own 60 % keeps it during a 50 % category sale, because 8 000 beats
10 000. **The shopper gets the better of the two, not the more specific one.**

## Vantage

Single machine, containers on one host, catalogue as stated. These are
**functional** results and one propagation latency; they are not load figures and
must not be quoted as service levels.
