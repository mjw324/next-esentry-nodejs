# Research API

Buyer-side views of the **active** eBay market for one-off product research. The
first client is the owner's shopping-research workspace (`mjw324/shopping`), which
calls it from a CLI with a personal access token. Monitors answer "tell me when
something new is listed"; this answers "what does this cost on eBay right now, in
the condition I'd buy, shipped to me?".

Both endpoints are mounted under `/api/research`, require authentication, and are
per-user rate limited like `/api/insights`. Each uncached request costs **one**
Browse call against the shared daily quota (it refuses with 429 near the soft cap)
and is cached in Redis for 10 minutes.

## Authentication

Either a better-auth session token (same as every other route) or a **personal
access token**:

```
Authorization: Bearer esp_<random>
```

Personal tokens are configured on the service, hashed:

```
PERSONAL_ACCESS_TOKENS=<userId>:<sha256 hex of the token>[,<userId>:<hash>...]
```

Only the hash lives in Railway. To rotate: generate a new `esp_` token, replace the
hash, redeploy. A token not in the list gets 401. Tokens with the `esp_` prefix
are never looked up in the Session table.

## `POST /api/research/search`

```jsonc
{
  "q": "macbook pro 14 m4 16gb",          // required
  "conditions": ["USED", "REFURBISHED"],    // NEW | OPEN_BOX | NEW_WITH_DEFECTS | REFURBISHED |
                                            // CERTIFIED_REFURBISHED | SELLER_REFURBISHED | USED | FOR_PARTS | "3000"
  "categoryIds": ["111422"],               // one category (eBay limit)
  "excludeCategoryIds": ["31530"],
  "buyingOptions": ["AUCTION", "FIXED_PRICE"], // default: eBay's default (fixed price only)
  "minPrice": 800, "maxPrice": 2000,
  "excludedKeywords": ["parts", "broken"], // whole-word title match, applied after the call
  "aspects": { "RAM Size": ["16 GB"] },    // needs categoryIds
  "sort": "best",                          // best | price | -price | newlyListed | endingSoonest
  "limit": 100,                            // ≤ 200
  "usOnly": true, "freeShipping": false, "returnsAccepted": false,
  "zip": "19103"                           // buyer ZIP for calculated shipping
}
```

Response (abridged):

```jsonc
{
  "q": "...", "total": 178, "returned": 50, "excluded": 0,
  "filter": "deliveryCountry:US,conditionIds:{2750|2990|3000|...}",
  "warnings": [],
  "stats": {
    "totalPrice": { "median": 1603.57, "q1": 1356.49, "q3": 1805.59, "min": 699.99, "max": 4970, "sampleSize": 50, ... },
    "byCondition": [{ "condition": "Used", "n": 50, "median": 1603.57 }]
  },
  "refinements": { "conditions": [...], "categories": [...], "aspects": [{ "name": "RAM Size", "values": [...] }] },
  "items": [{
    "itemId": "v1|920043228941|0", "legacyItemId": "920043228941", "title": "...", "url": "...",
    "condition": "Used", "conditionId": "3000",
    "price": 1299.99, "shipping": 0, "total": 1299.99,   // auctions: price = current bid
    "buyingOptions": ["FIXED_PRICE"], "bidCount": null, "endsAt": null, "isRelist": false,
    "originalPrice": null, "discountPercentage": null,
    "seller": { "username": "...", "feedbackScore": 5311, "feedbackPercentage": 99.3 },
    "topRated": false, "authenticityGuarantee": false, "location": { "country": "US" }, "categoryId": "111422"
  }]
}
```

Every search adds `deliveryCountry:US`. Stats are **sample-based** (the listings
returned), over shipping-inclusive totals; `total` is eBay's approximate
full-population count.

## `GET /api/research/item/:id[?zip=19103]`

`:id` is a v1 ID (`v1|123456789012|0`, URL-encode the pipes) or the legacy number
from an `ebay.com/itm/…` URL. Returns condition notes and descriptors, shipping
options with delivery windows, return terms, seller, availability (including
sold quantity on multi-quantity listings), item specifics, a plain-text
description (≤ 4,000 chars), and brand/MPN/GTIN/ePID. An ended or missing listing
returns 404.

## Condition filter fix (applies to monitors too)

`buildFilterString` used to send condition *names* as `conditionIds:{NEW}`.
eBay answers that with warning 12002 and **ignores the filter**, so condition
filters on monitors and insights never applied. `utils/conditions.ts` now maps
names to IDs for every path. No production monitor used conditions at the time
of the change (2026-10-16), so no alert behaviour changed.

## Limits

- Sold prices are not available (Marketplace Insights is closed to this keyset).
  The workspace gets sold comps from eBay's web sold-listings in a signed-in
  browser instead.
- `matchCount`s in refinements don't add up to `total`, and condition
  refinements come back with zero counts when a category is set (eBay quirk).
