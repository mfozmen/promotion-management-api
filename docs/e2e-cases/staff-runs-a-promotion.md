# ModaCo staff run a promotion

Persona: ModaCo staff, the user of the internal API the case study describes
in section 1. The case study does not name this role, so nothing more specific
is claimed.

## S4 Create a promotion

As ModaCo staff, I want to create a promotion with a name, a discount that is
either a percentage or a fixed amount, a value and a start and end date, so
that a seasonal discount exists before it has to go live.

Acceptance criteria

- A valid promotion is stored and returned with its identifier.
- A percentage above 100, a negative value, or an end before the start is rejected, and the rejection names the part of the request at fault — the body, the query or the params — rather than the field or its value. (Owner decision, 2026-09-13; ADR-0009's boundary.)
- A promotion created without naming a product or a category is stored, but changes no price until it is assigned. (Case study section 2 lists creating and assigning as separate capabilities.)
- A promotion created with a product or a category named is live from its start without a second call from me. (Issue #11 acceptance criteria, owner: "`POST /api/promotions` with `productId` or `category` … `201` with status `active`".)

Test cases

### promotion-1

- Precondition: `POST /api/promotions`
- Given: a promotion "Winter 20" of 20 % from next Monday to next Sunday
- When: staff create it
- Then: 201 with the stored promotion, dates and discount as sent
- Measure: none

### promotion-2

- Precondition: `POST /api/promotions`
- Given: three bad bodies — 150 %, a fixed amount of −5, an end date before the start
- When: each is posted
- Then: 400 for each, and the message names the part of the request that was rejected — the body, the query or the params — without echoing the value back
- Measure: none

### promotion-11

- Precondition: `POST /api/promotions`, `GET /api/products/:id`
- Given: a product at 100.00 whose category carries no promotion
- When: staff create a 20 % promotion running today without naming a product or a category, and a shopper then opens the product
- Then: 201 with an identifier staff can assign later, and the product still shows 100.00
- Measure: none

### promotion-16

- Precondition: `POST /api/promotions`, `GET /api/products/:id`
- Given: a product at 40.00 in Accessories, and no promotion anywhere near it
- When: staff create a 50 % promotion naming the category Accessories, starting now and ending tomorrow, and make no other call
- Then: 201, and a shopper opening the product sees 20.00 and the promotion named
- Measure: time from the create response to 20.00 appearing on the storefront; measured and recorded, with no bound until a run sets one (owner, 2026-09-14)

## S5 Assign a promotion to a product or a category

As ModaCo staff, I want to assign a promotion to one product or to an entire
category, so that a discount can be as narrow as one item or as wide as a
whole line.

Acceptance criteria

- A promotion assigned to a product changes that product's effective price and no other.
- A promotion assigned to a category changes every product in that category.
- A request that names no promotion at all — an identifier that is not a positive whole number — is refused as a bad request naming the part of the request at fault, not reported as a promotion that does not exist. (Owner decision, 2026-09-13.)

Test cases

### promotion-3

- Precondition: `POST /api/promotions/:id/assign`, `GET /api/products/:id`
- Given: an active 10 % promotion and a product with base price 100.00
- When: staff assign the promotion to that product
- Then: the product's detail shows effective price 90.00, and a sibling product in the same category still shows its base price
- Measure: none

### promotion-4

- Precondition: `POST /api/promotions/:id/assign`, `GET /api/products?category=`
- Given: an active fixed promotion of 5.00 and a category with 40 products
- When: staff assign it to the category
- Then: every one of the 40 shows base minus 5.00, and a product outside the category is unchanged
- Measure: none

### promotion-19

- Precondition: `POST /api/promotions/:id/assign`, `POST /api/promotions/:id/cancel`
- Given: a draft promotion staff can address by its own identifier, and two paths that address no promotion at all — `abc` and `-1`
- When: staff assign to `/api/promotions/abc/assign` and cancel `/api/promotions/-1/cancel`, then assign the draft by its real identifier
- Then: 400 for each of the two, the message naming the params as the part rejected rather than the body — never 404, never 500 — and the third call succeeds, so a bad path is told apart from a promotion that is merely missing
- Measure: none

## S6 At most one promotion applies to a product

As ModaCo staff, I want the system to apply at most one promotion to a product
and to settle conflicts logically, so that a shopper never sees two discounts
stacked and I never have to untangle an overlap by hand.

Acceptance criteria

- Two product-level promotions cannot both be active on one product at the same time; the second is refused, and the refusal names no promotion. (Owner decision, 2026-09-13; the trade-off is in ADR-0004.)
- Staff refused an overlap can find the promotion that blocked them, so a conflict is something they can get out of without a database prompt. (Case study section 1: "promotion conflicts must be handled logically"; the one-request answer was given up by the owner decision of 2026-09-13, which leaves the promotion list as the way out.)
- A refused second promotion changes no price: the product goes on being priced by the promotion already in place. (Case study section 1: "a product can have at most one active promotion at a time".)
- The same holds for a category: two promotions whose dates overlap cannot both be active on one category, or every product in it would carry two.
- Two staff assigning at the same moment cannot both win; one assignment succeeds and the other is refused. (Owner decision on issue #11, 2026-09-12.)
- When a product-level and a category-level promotion are both active, the one that prices the product lower is applied, in the shopper's favour. (Owner decision, 2026-09-12.)
- The storefront says which promotion was applied.

Test cases

### promotion-5

- Precondition: `POST /api/promotions/:id/assign`
- Given: a product already carrying an active product-level promotion
- When: staff assign a second product-level promotion whose dates overlap
- Then: 409, and the message says an active promotion already covers that target for that window; it names no promotion, and the conflicting row's id appears nowhere in the response (owner decision, 2026-09-13)
- Measure: none

### promotion-12

- Precondition: `POST /api/promotions/:id/assign`, `GET /api/promotions`
- Given: the Accessories category already carrying an active 20 % promotion for this week
- When: staff assign a second promotion to Accessories over days that overlap it
- Then: 409, and the message says an active promotion already covers that target for that window; the admin finds the blocker with `GET /api/promotions?category=Accessories` (owner decision, 2026-09-13)
- Measure: none

### promotion-18

- Precondition: `GET /api/promotions`, `POST /api/promotions/:id/assign`, `POST /api/promotions/:id/cancel`
- Given: Accessories carrying an active promotion "Autumn 20" of 20 % running Monday to Sunday, a second Accessories promotion of 30 % for Wednesday to Friday that was just refused, and an unrelated active promotion on Footwear
- When: staff list promotions filtered to the category they were refused on, then cancel the promotion that list shows as holding the window, then assign the refused one again
- Then: the list holds "Autumn 20" with its name, its start and end and its state, and does not hold the Footwear promotion; after that cancel the second assign succeeds, and a shopper opening an Accessories product at 100.00 sees 70.00
- Measure: none

### promotion-6

- Precondition: `POST /api/promotions/:id/assign`, `GET /api/products/:id`
- Given: a product at 100.00 with its own 10 % promotion, and its category carrying a 30 % promotion
- When: the shopper opens the product
- Then: effective price 70.00, and the response names the category promotion as the one applied
- Measure: none

### promotion-7

- Precondition: same as promotion-6
- Given: the same product, but the category promotion is 5 %
- When: the shopper opens the product
- Then: effective price 90.00, and the response names the product's own promotion
- Measure: none

### promotion-17

- Precondition: `POST /api/promotions/:id/assign`, `GET /api/products/:id`
- Given: a product at 100.00 carrying an active product-level 10 % promotion, so the shopper sees 90.00
- When: staff assign a second product-level 50 % promotion whose dates overlap, and a shopper then opens the product
- Then: the product still shows 90.00 and still names the first promotion — never 50.00, never 45.00, and never two discounts stacked
- Measure: none

### promotion-13

- Precondition: `POST /api/promotions/:id/assign`, `GET /api/products/:id`
- Given: a product carrying no promotion, and two promotions of 10 % and 30 % covering the same week
- When: two staff assign both to that product at the same moment, repeated over ten fresh products
- Then: every round answers with exactly one 200 and one 409, never two of either and never a 500, and the product ends up priced by the promotion that won
- Measure: ten rounds; one success and one refusal in each, zero 5xx, zero timeouts

## S7 Cancel a promotion

As ModaCo staff, I want to cancel a promotion, so that a mistake or an ended
campaign stops affecting prices the moment I say so.

Acceptance criteria

- After cancellation the affected products show their base price, or the next promotion that applies to them.
- A cancelled promotion cannot be assigned again.
- Cancelling a promotion that is already cancelled is not an error and changes no price. (Issue #11 acceptance criteria, owner: "cancel … is idempotent".)

Test cases

### promotion-8

- Precondition: `POST /api/promotions/:id/cancel`, `GET /api/products/:id`
- Given: a product discounted by an active promotion
- When: staff cancel that promotion
- Then: the product's detail shows its base price
- Measure: time from the cancel response to the base price appearing on the storefront; measured and recorded, with no bound until a run sets one (owner, 2026-09-14)

### promotion-9

- Precondition: `POST /api/promotions/:id/cancel`, `POST /api/promotions/:id/assign`
- Given: a cancelled promotion
- When: staff try to assign it
- Then: 409, the promotion is cancelled
- Measure: none

### promotion-14

- Precondition: `POST /api/promotions/:id/cancel`, `GET /api/products/:id`
- Given: a product at 100.00 with its own 25 % promotion, and its category carrying a 10 % promotion over the same days
- When: staff cancel the product's own promotion
- Then: the product shows 90.00 and names the category promotion, not 100.00 and not 75.00
- Measure: time from the cancel response to 90.00 appearing on the storefront; measured and recorded, with no bound until a run sets one (owner, 2026-09-14)

### promotion-15

- Precondition: `POST /api/promotions/:id/cancel`, `GET /api/products/:id`
- Given: a product at 100.00 discounted by a 20 % promotion that staff have already cancelled once, the product now showing 100.00
- When: staff cancel the same promotion a second time
- Then: the call succeeds rather than failing, and the product still shows 100.00
- Measure: none

## S8 A promotion applies only between its dates

As ModaCo staff, I want a promotion to start and stop on the dates I gave it,
so that I can schedule a campaign ahead and trust it to end without me.

Acceptance criteria

- Before its start date a promotion has no effect on prices.
- At its start it applies; at its end it stops, with no action from staff.
- A boundary whose announcement was lost still reaches the storefront: the next sweep repairs it once, and having repaired it the system moves on rather than repairing the same boundary for ever. (Owner decision, 2026-09-14: a repair mechanism has to be verified end to end, and the observable is the shopper-facing price.)

Test cases

### promotion-10

- Precondition: `POST /api/promotions`, `GET /api/products/:id`, the boundary scheduler
- Given: a promotion on a product with a start two minutes away and an end four minutes away
- When: the product is read before the start, after the start, and after the end
- Then: base price, then discounted price, then base price again
- Measure: the delay between each boundary's time and its effect on the storefront; measured and recorded, with no bound until a run sets one (owner, 2026-09-14)

### promotion-20

- Precondition: `POST /api/promotions`, `GET /api/products/:id`, the boundary scheduler (#12), the reconciler sweep worker and its schedule (#109)
- Given: a product at 100.00 carrying a 20 % promotion whose start has just passed, and whose `promotion.changed` announcement never reached the read model, so the storefront still serves 100.00
- When: staff let the sweep run, a shopper opens the product, and staff then let one further sweep run over the same window before the shopper opens it again
- Then: the first sweep repairs the boundary once and the shopper sees 80.00 naming that promotion; the second sweep reports no repair for that boundary and the shopper still sees 80.00 — the same boundary is never repaired twice
- Measure: time from the sweep that repairs it to 80.00 appearing on the storefront; measured and recorded, with no bound until a run sets one (owner, 2026-09-14). Repairs counted for that boundary across the two sweeps, exactly one, and a second repair fails it
