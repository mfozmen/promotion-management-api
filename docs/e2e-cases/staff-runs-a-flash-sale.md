# ModaCo staff run a flash sale

Persona: ModaCo staff creating the campaign, and the shopper on the storefront
while it runs. Case study, Scenario B: "50 % Off All Accessories", 50,000
products, massive read traffic, a new product added during the sale.

## S11 A flash sale hits the whole category at once

As ModaCo staff, I want a category-wide sale to reach every product in the
category the moment I create it, so that "50 % off all Accessories" is true
on the storefront the second it is announced.

Acceptance criteria

- Every product in the category shows the discounted price on the storefront within seconds of the campaign being created.
- No product in the category is missed, and no product outside it is touched.

Test cases

### flash-sale-1

- Precondition: `POST /api/promotions`, `POST /api/promotions/:id/assign`, `GET /api/products`
- Given: the Accessories category with 50,000 products
- When: staff create and assign a 50 % promotion to Accessories, and the storefront is polled until every Accessories product shows half price
- Then: all 50,000 show half their base price; a product in Footwear is unchanged
- Measure: time from the assign response until the last product reflects the sale, median of three runs, with the number reported

## S12 A product added during the sale gets the discount

As ModaCo staff, I want a product I add to Accessories while the sale is on to
be discounted automatically, so that nothing new goes out at full price by
accident.

Acceptance criteria

- A product created in the category during the sale shows the discounted price on its first read, with no extra step from staff.

Test cases

### flash-sale-2

- Precondition: `POST /api/products`, `GET /api/products/:id`, an active category promotion
- Given: the Accessories sale active
- When: staff create a new Accessories product at base 40.00 and a shopper opens it
- Then: the page shows 20.00 and names the sale as the promotion applied
- Measure: time from the create response to the first read showing 20.00, under 5 seconds

## S13 The storefront stays fast while the sale is applied

As a shopper, I want the storefront to keep answering while a flash sale is
starting and while everyone else is browsing it, so that the sale does not
take the shop down.

Acceptance criteria

- Listing and product pages keep answering with correct prices while 50,000 products are being repriced.
- Read traffic during the sale does not fail, slow to a crawl, or return stale prices once the sale has landed.

Test cases

### flash-sale-3

- Precondition: `GET /api/products`, `GET /api/products/:id`, an active category promotion in progress
- Given: 100 concurrent shoppers listing Accessories and opening products
- When: staff create the 50 % sale in the middle of that traffic and it is applied across the category
- Then: every response is a 200; a price is either the pre-sale or the post-sale price, never anything else; after the sale has landed no read returns a pre-sale price
- Measure: p99 latency and error count over the run, median of three; zero non-2xx; zero timeouts

### flash-sale-4

- Precondition: `GET /api/products`, `GET /api/products/:id`
- Given: the sale fully applied
- When: 100 concurrent shoppers list and open Accessories products for 15 seconds
- Then: every response correct, none from the write database
- Measure: p99 latency under 300 ms at 100 connections, median of three runs; PostgreSQL statement count during the run near zero. The bar is provisional: it was derived from a run of the health route on one machine, never from these routes. A run that overshoots it fails the case; only an owner decision raises it.

## S14 Ending the sale

As ModaCo staff, I want to cancel the flash sale and have every product go
back to its base price, so that a sale that must stop, stops everywhere.

Test cases

### flash-sale-5

- Precondition: `POST /api/promotions/:id/cancel`, `GET /api/products`
- Given: the Accessories sale active on 50,000 products
- When: staff cancel it
- Then: every Accessories product shows its base price again, or the next promotion that applies to it; nothing outside the category changes
- Measure: time from the cancel response until the last product is back at base, median of three runs, reported
