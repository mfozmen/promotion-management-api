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
- A percentage above 100, a negative value, or an end before the start is rejected with a reason I can act on.
- A promotion created without naming a product or a category is stored, but changes no price until it is assigned. (Case study section 2 lists creating and assigning as separate capabilities.)

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
- Then: 400 for each, and the reason names the field that was wrong
- Measure: none

### promotion-11

- Precondition: `POST /api/promotions`, `GET /api/products/:id`
- Given: a product at 100.00 whose category carries no promotion
- When: staff create a 20 % promotion running today without naming a product or a category, and a shopper then opens the product
- Then: 201 with an identifier staff can assign later, and the product still shows 100.00
- Measure: none

## S5 Assign a promotion to a product or a category

As ModaCo staff, I want to assign a promotion to one product or to an entire
category, so that a discount can be as narrow as one item or as wide as a
whole line.

Acceptance criteria

- A promotion assigned to a product changes that product's effective price and no other.
- A promotion assigned to a category changes every product in that category.

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

## S6 At most one promotion applies to a product

As ModaCo staff, I want the system to apply at most one promotion to a product
and to settle conflicts logically, so that a shopper never sees two discounts
stacked and I never have to untangle an overlap by hand.

Acceptance criteria

- Two product-level promotions cannot both be active on one product at the same time; the second is refused and the refusal names the first.
- The same holds for a category: two promotions whose dates overlap cannot both be active on one category, or every product in it would carry two.
- Two staff assigning at the same moment cannot both win; one assignment succeeds and the other is refused. (Owner decision on issue #11, 2026-09-12.)
- When a product-level and a category-level promotion are both active, the one that prices the product lower is applied, in the shopper's favour. (Owner decision, 2026-09-12.)
- The storefront says which promotion was applied.

Test cases

### promotion-5

- Precondition: `POST /api/promotions/:id/assign`
- Given: a product already carrying an active product-level promotion
- When: staff assign a second product-level promotion whose dates overlap
- Then: 409, and the response names the promotion already in place
- Measure: none

### promotion-12

- Precondition: `POST /api/promotions/:id/assign`
- Given: the Accessories category already carrying an active 20 % promotion for this week
- When: staff assign a second promotion to Accessories over days that overlap it
- Then: 409, and the response names the promotion already on the category
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

Test cases

### promotion-8

- Precondition: `POST /api/promotions/:id/cancel`, `GET /api/products/:id`
- Given: a product discounted by an active promotion
- When: staff cancel that promotion
- Then: the product's detail shows its base price
- Measure: time from the cancel response to the base price appearing on the storefront, under 5 seconds

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
- Measure: time from the cancel response to 90.00 appearing on the storefront, under 5 seconds

## S8 A promotion applies only between its dates

As ModaCo staff, I want a promotion to start and stop on the dates I gave it,
so that I can schedule a campaign ahead and trust it to end without me.

Acceptance criteria

- Before its start date a promotion has no effect on prices.
- At its start it applies; at its end it stops, with no action from staff.

Test cases

### promotion-10

- Precondition: `POST /api/promotions`, `GET /api/products/:id`, the boundary scheduler
- Given: a promotion on a product with a start two minutes away and an end four minutes away
- When: the product is read before the start, after the start, and after the end
- Then: base price, then discounted price, then base price again
- Measure: each boundary takes effect within 5 seconds of its time
