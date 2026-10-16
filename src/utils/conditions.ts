/**
 * Map condition names to eBay condition IDs for the `conditionIds` filter.
 *
 * eBay rejects names in `conditionIds:{...}` with warning 12002 and then returns
 * UNFILTERED results (docs/EBAY_API_OPPORTUNITIES.md 3.1), so a monitor or
 * research search asking for "NEW" silently saw every condition. Numeric IDs
 * pass through unchanged; unknown names are dropped rather than sent.
 *
 * Buckets are coarse on purpose: REFURBISHED covers eBay's certified grades and
 * seller refurbished, USED covers every pre-owned grade.
 */
const CONDITION_IDS: Record<string, string[]> = {
  NEW: ['1000'],
  OPEN_BOX: ['1500'],
  NEW_OTHER: ['1500'],
  NEW_WITH_DEFECTS: ['1750'],
  REFURBISHED: ['2000', '2010', '2020', '2030', '2500'],
  CERTIFIED_REFURBISHED: ['2000'],
  SELLER_REFURBISHED: ['2500'],
  USED: ['2750', '2990', '3000', '3010', '4000', '5000', '6000'],
  FOR_PARTS: ['7000'],
};

// Older callers use ebayConfig.conditionMap's camelCase names.
const ALIASES: Record<string, string> = {
  OPENBOX: 'OPEN_BOX',
  PARTS: 'FOR_PARTS',
};

export function conditionIdsFor(conditions: string[]): string[] {
  const ids = new Set<string>();
  for (const raw of conditions) {
    const value = raw.trim();
    if (/^\d{4}$/.test(value)) {
      ids.add(value);
      continue;
    }
    const name = value.toUpperCase().replace(/[\s-]+/g, '_');
    for (const id of CONDITION_IDS[ALIASES[name] ?? name] ?? []) ids.add(id);
  }
  return [...ids];
}

export const CONDITION_NAMES = Object.keys(CONDITION_IDS);
