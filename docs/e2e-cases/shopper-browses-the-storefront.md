# The shopper browses the storefront

Persona: the shopper, reading through the storefront the case study names in
section 2 and Scenario B ("GET /products … the storefront").

## S9 List a category by price

As a shopper, I want to list the products in a category, page through them
and sort them by the price I would actually pay, so that I can find the
cheapest thing I want without opening every product.

Acceptance criteria

- The list can be filtered to one category, and with no category chosen the shopper browses the whole catalogue.
- The list is paginated. While prices are still, two pages never share a product or skip one; while a sale is changing them, a product whose price moves may be seen twice or missed, because the pages are cut by price and the price is what changed.
- The list can be sorted by effective price, ascending or descending.
- Each page tells the shopper how many products the list holds, so they know how many pages there are.
- A page larger than 100 items is refused rather than served (owner decision, issue #13).
- Every item shows its effective price, which is the price after the active promotion, not the base price.
- Before the storefront has prices to show, the shopper is told the catalogue is not ready rather than shown an empty or stale one (owner decision, issue #13).

Test cases

### shopper-1

- Precondition: `GET /api/products`
- Given: a category with 45 products, some discounted
- When: the shopper asks for that category sorted by effective price ascending, 20 per page, pages 1 to 3
- Then: 20, 20 and 5 items; the union is the 45 with no duplicate; every page is in ascending order and the last item of one page is not above the first of the next; every page reports the same total of 45 alongside the page asked for
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
- Then: every product the shopper sees is a real product of that category at a price that was true when the page was built, and the page they asked for is the size they asked for; a product whose price moved across the page boundary may appear twice or not at all, which is the cost of ordering by the thing the sale changes
- Measure: none

### shopper-7

- Precondition: `GET /api/products`
- Given: a freshly started storefront whose catalogue has not been built yet
- When: the shopper opens a category list
- Then: the request is refused with 503 and the code `READ_MODEL_NOT_READY`; no empty list and no prices are shown; when the catalogue is ready the same request returns the category's products
- Measure: none

### shopper-8

- Precondition: `GET /api/products`
- Given: a category with 45 products
- When: the shopper asks for 500 of them on one page
- Then: the request is refused with 400 and no list is returned; asking for 100 on one page is served
- Measure: none

### shopper-9

- Precondition: `GET /api/products`
- Given: a catalogue holding several categories, the dearest item after promotions at 480.00 and the cheapest at 9.99
- When: the shopper lists products with no category chosen, sorted by effective price descending, first page of 20
- Then: the first item is the 480.00 one, the page descends, no item of any category is excluded, and the total counts the whole catalogue rather than one category
- Measure: none

## S10 Open a product

As a shopper, I want to open one product and see the price I would pay, so
that what I see on the product page is what I am charged.

Acceptance criteria

- The product page shows the effective price, the base price it came from, and which promotion applied.
- The product page and the list agree on the price.
- Opening a product the catalogue does not hold tells the shopper it is not there, rather than showing a page with no price (owner decision, issue #13).
- Before the storefront has prices to show, opening a product is refused the same way a list is, rather than answering from stale or absent data (owner decision, issue #13).
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
- Then: 404, and no product, price or promotion is shown
- Measure: none

### shopper-6

- Precondition: `GET /api/products/:id`
- Given: one product opened by many shoppers at once
- When: 100 concurrent shoppers read it for 15 seconds
- Then: every response is a 200 with the same price, none fails, none times out
- Measure: p99 latency, median of three runs, under 300 ms at 100 connections; zero non-2xx; zero errors. The bar is derived from the measured baseline rather than chosen: `GET /api/health`, which serialises a constant and touches nothing, measures 130-192 ms p99 at this same concurrency on this machine (ADR-0009), so the criterion is that the detail route's two Redis commands add no more than about 100 ms to a route that does nothing. Re-derive it against a fresh baseline on different hardware; the 100 ms it replaced was below what the empty route clears, so no run could have passed it (owner decision, 2026-09-13)

### shopper-10

- Precondition: `GET /api/products/:id`
- Given: a freshly started storefront whose catalogue has not been built yet
- When: the shopper opens a product straight from a link
- Then: the request is refused with 503 and the code `READ_MODEL_NOT_READY`; no price is shown; when the catalogue is ready the same link shows the product and its effective price
- Measure: none
