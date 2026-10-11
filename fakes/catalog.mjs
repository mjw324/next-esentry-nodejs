// Seed inventory for the fake eBay Browse API. Deterministic so runs are
// comparable: same ids, same prices, creation dates relative to boot time.

const CONDITIONS = {
  '1000': 'New',
  '1500': 'Open box',
  '2500': 'Seller refurbished',
  '3000': 'Used',
  '7000': 'For parts or not working',
};

const FAMILIES = [
  {
    category: { categoryId: '139971', categoryName: 'Video Game Consoles' },
    brand: 'Nintendo',
    base: 'Nintendo Switch OLED Console',
    variants: ['White Joy-Con', 'Neon Red/Blue', 'Zelda Edition', 'Mario Red Edition', 'w/ Dock + Case', 'Bundle 3 Games'],
    price: [180, 360],
  },
  {
    category: { categoryId: '15230', categoryName: 'Film Cameras' },
    brand: 'Leica',
    base: 'Leica M6 35mm Rangefinder Film Camera',
    variants: ['Black Body', 'Silver Chrome', 'TTL 0.72', 'Classic w/ Box', 'Body Only CLA\'d'],
    price: [2400, 4800],
  },
  {
    category: { categoryId: '183454', categoryName: 'CCG Individual Cards' },
    brand: 'Pokemon',
    base: 'Pokemon Charizard Base Set 4/102 Holo',
    variants: ['PSA 9', 'PSA 7', 'Unlimited Raw', 'Shadowless', 'BGS 8.5', 'Damaged Proxy Lot'],
    price: [90, 2200],
  },
  {
    category: { categoryId: '177', categoryName: 'PC Laptops & Netbooks' },
    brand: 'Lenovo',
    base: 'Lenovo ThinkPad X1 Carbon Gen 11',
    variants: ['i7 32GB 1TB', 'i5 16GB 512GB', 'OLED 2.8K', 'For Parts Cracked Screen', 'Sealed New'],
    price: [350, 1600],
  },
];

const SELLERS = [
  { username: 'retro_resale', feedbackPercentage: '99.8', feedbackScore: 4210 },
  { username: 'camera_corner', feedbackPercentage: '100.0', feedbackScore: 15890 },
  { username: 'cardshark_88', feedbackPercentage: '97.1', feedbackScore: 312 },
  { username: 'tech_liquidators', feedbackPercentage: '98.9', feedbackScore: 88021 },
  { username: 'newseller2026', feedbackPercentage: '0.0', feedbackScore: 0 },
];

let counter = 0;

/** Pseudo-random but deterministic in [0,1) from an integer seed. */
function rand(seed) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function nextItemId() {
  counter += 1;
  return `v1|${String(110000000000 + counter)}|0`;
}

/**
 * Build a full Browse-shaped itemSummary from a partial. Anything omitted gets
 * a plausible default; `title` is the only field worth always setting.
 */
export function makeItem(partial = {}, seed = counter + 1) {
  const itemId = partial.itemId ?? nextItemId();
  const numeric = itemId.split('|')[1] ?? itemId;
  const conditionId = String(partial.conditionId ?? ['1000', '3000', '3000', '1500', '7000'][seed % 5]);
  const seller = partial.seller ?? SELLERS[seed % SELLERS.length];
  const price = partial.price ?? { value: (50 + rand(seed) * 500).toFixed(2), currency: 'USD' };
  return {
    itemId,
    title: partial.title ?? `Fake listing ${numeric}`,
    leafCategoryIds: [partial.category?.categoryId ?? '99'],
    categories: [partial.category ?? { categoryId: '99', categoryName: 'Everything Else' }],
    image: { imageUrl: `https://i.ebayimg.com/images/g/fake${numeric}/s-l225.jpg` },
    price: typeof price === 'number' || typeof price === 'string'
      ? { value: Number(price).toFixed(2), currency: 'USD' }
      : price,
    itemHref: `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(itemId)}`,
    seller,
    condition: partial.condition ?? CONDITIONS[conditionId] ?? 'Used',
    conditionId,
    thumbnailImages: [{ imageUrl: `https://i.ebayimg.com/images/g/fake${numeric}/s-l140.jpg` }],
    shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '0.00', currency: 'USD' } }],
    buyingOptions: partial.buyingOptions ?? (seed % 3 === 0 ? ['AUCTION'] : ['FIXED_PRICE', 'BEST_OFFER']),
    itemWebUrl: `https://www.ebay.com/itm/${numeric}`,
    itemLocation: { postalCode: '181**', country: 'US' },
    adultOnly: false,
    legacyItemId: numeric,
    availableCoupons: false,
    itemCreationDate: partial.itemCreationDate ?? new Date().toISOString(),
    topRatedBuyingExperience: seed % 4 === 0,
    priorityListing: false,
    listingMarketplaceId: 'EBAY_US',
    // Not a Browse field: used by the fake to build aspect refinements.
    _aspects: partial._aspects ?? { Brand: partial.brand ?? 'Unbranded' },
  };
}

export function seedCatalog(now = Date.now()) {
  counter = 0;
  const items = [];
  let seed = 1;
  for (const fam of FAMILIES) {
    for (let i = 0; i < 12; i++) {
      const variant = fam.variants[i % fam.variants.length];
      const [lo, hi] = fam.price;
      const conditionId = ['1000', '3000', '3000', '1500', '3000', '7000'][i % 6];
      items.push(
        makeItem(
          {
            title: `${fam.base} ${variant}`,
            price: (lo + rand(seed) * (hi - lo)).toFixed(2),
            conditionId,
            category: fam.category,
            brand: fam.brand,
            // Spread creation over the last ~10 days, newest first by index.
            itemCreationDate: new Date(now - (seed * 3.7 + i) * 3600_000).toISOString(),
            _aspects: { Brand: fam.brand, Model: fam.base.split(' ').slice(1, 3).join(' ') },
          },
          seed
        )
      );
      seed += 1;
    }
  }
  return items;
}
