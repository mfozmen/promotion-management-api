# Promotions: create, assign, cancel, conflict — probed live

Real HTTP against the compose stack on `127.0.0.1:3100`. A private category was
used so nothing here disturbed the 100 000-product catalogue the load runs use.

## The case study's third core expectation

> "Create, cancel, and assign promotions to products or categories."

| Probe                                   | Result                                     |
| --------------------------------------- | ------------------------------------------ |
| `POST /api/promotions` with `category`  | `201`, `status: active`, `state: live`     |
| `POST /api/promotions` with `productId` | `201`                                      |
| `POST /api/promotions/:id/cancel`       | `200`, `status: cancelled`                 |
| cancel the same promotion again         | `200`, same body — idempotent, not a `409` |
| cancel an id that does not exist        | `404`                                      |

## "A product can have at most one active promotion at a time"

A second promotion overlapping the same category window is refused:

```
409 {"error":{"message":"An active promotion already covers that target for this window"}}
```

The refusal names the target and the window and **not the promotion it collided
with** — the conflicting row is another record the caller never saw.

**A product-level promotion is not a conflict with a category-level one**, and this
is the interesting half. With a 50 % sale running on the category, a 70 %
promotion on one product was accepted (`201`), and the storefront then served:

```
EV-…-1  3000  "Ev prod …"      <- its own 70 %
EV-…-2  5000  "Ev sale …"      <- the category's 50 %
```

So "one active promotion at a time" is enforced **per target** at write time, and
the resolver decides which one applies at read time. Cancelling the product
promotion returned that product to the category price (5000) without another
request.

## Pricing edges

- **A fixed discount larger than the base price floors at zero, not below.**
  A 9 999.99 discount on a 100.00 product served `effectivePriceCents: 0`. The
  write was accepted — the floor is in the calculation, not the validator, which is
  the right place for it: the same promotion applied to a dearer product is
  meaningful.
- **Sorting handles the zero correctly**: ascending put the zero-priced product
  first.

## Validation refusals, all `400` with the envelope

- a promotion whose whole window is in the past
- `endsAt` before `startsAt`
- a percentage above 100

## Propagation

Each write above was visible in the storefront within the few seconds between the
request and the next read. A measured figure for this exists separately: **444 ms**
from a `POST /api/products` to the storefront serving it at the sale price, through
the real queues.

## Vantage

Single machine, one host, catalogue ~100 000 products. Functional results; no
figure here is a load or latency measurement.
