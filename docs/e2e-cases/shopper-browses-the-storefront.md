# The shopper browses the storefront

Persona: the shopper, reading through the storefront the case study names in
section 2 and Scenario B ("GET /products … the storefront").

## S9 List a category by price

As a shopper, I want to list the products in a category, page through them
and sort them by the price I would actually pay, so that I can find the
cheapest thing I want without opening every product.

Acceptance criteria

- The list can be filtered to one category.
- The list is paginated, and two pages never share a product or skip one.
- The list can be sorted by effective price, ascending or descending.
- Every item shows its effective price, which is the price after the active promotion, not the base price.
- Before the storefront has prices to show, the shopper is told the catalogue is not ready rather than shown an empty or stale one (owner decision, issue #13).

Test cases

### shopper-1

- Precondition: `GET /api/products`
- Given: a category with 45 products, some discounted
- When: the shopper asks for that category sorted by effective price ascending, 20 per page, pages 1 to 3
- Then: 20, 20 and 5 items; the union is the 45 with no duplicate; every page is in ascending order and the last item of one page is not above the first of the next
- Measure: none

### shopper-2

- Precondition: `GET /api/products`
- Given: a product at base 100.00 with an active 25 % promotion
- When: the shopper lists its category
- Then: the item shows 75.00 as its effective price and the promotion that produced it
- Measure: none

### shopper-3

- Precondition: `GET /api/products`
- Given: a category with more products than one page holds
- When: the shopper reads page 2 while a product on page 1 is discounted and moves
- Then: the shopper still sees every product exactly once across the pages they read
- Measure: none

### shopper-7

- Precondition: `GET /api/products`
- Given: a freshly started storefront whose catalogue has not been built yet
- When: the shopper opens a category list
- Then: the request is refused with 503 and the code `READ_MODEL_NOT_READY`; no empty list and no prices are shown; when the catalogue is ready the same request returns the category's products
- Measure: none

## S10 Open a product

As a shopper, I want to open one product and see the price I would pay, so
that what I see on the product page is what I am charged.

Acceptance criteria

- The product page shows the effective price, the base price it came from, and which promotion applied.
- The product page and the list agree on the price.
- This is the most requested page in the system and it stays fast when many shoppers open it at once.

Test cases

### shopper-4

- Precondition: `GET /api/products/:id`
- Given: a product visible in a category list with effective price 75.00
- When: the shopper opens it
- Then: the page shows 75.00, base 100.00, and the same promotion the list named
- Measure: none

### shopper-5

- Precondition: `GET /api/products/:id`
- Given: an identifier that no product has
- When: the shopper opens it
- Then: 404 with a message that does not echo the identifier back
- Measure: none

### shopper-6

- Precondition: `GET /api/products/:id`
- Given: one product opened by many shoppers at once
- When: 100 concurrent shoppers read it for 15 seconds
- Then: every response is a 200 with the same price, none fails, none times out
- Measure: p99 latency, median of three runs, under 100 ms; zero non-2xx; zero errors
