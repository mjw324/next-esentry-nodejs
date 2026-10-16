// src/services/sold-tracker.service.ts
//
// Sold-price tracking from auction results.
//
// eBay's sold-price API (Marketplace Insights) is closed to this keyset, but an
// auction stays readable through Browse getItem after it ends, with its final
// bid and whether it sold. So for each tracked query the tracker notes auctions
// that are about to end, reads each one back once it has ended, and records the
// ones eBay reports as sold (see toSale). Over weeks that builds a
// real sold-price history for the query, without scraping.
//
// Storage is Redis (persisted to the volume): track definitions, a pending set
// scored by when to read an auction back, and a capped list of sales per track.
// Clients that want a permanent record (the shopping workspace) sync the sales
// into their own store.

import { Redis } from 'ioredis';
import { randomUUID } from 'crypto';
import { EbayService } from './ebay.service';
import { buildFilter } from './research.service';
import { NotFoundError, RateLimitError } from '../utils/errors';
import { logger } from '../utils/logger';
import { median, quartiles, min, max } from '../utils/insights/statistics';
import { SoldTrack, SoldTrackInput, AuctionSale, SoldTrackSales } from '../types/research.types';

/** How often the tracker runs. */
export const SOLD_TRACKER_INTERVAL_MS = 60 * 60 * 1000;
/** Auctions ending within this window are queued each run (overlaps the interval). */
const LOOKAHEAD_MS = 90 * 60 * 1000;
/** Read an auction back this long after its scheduled end (eBay settles late bids). */
const SETTLE_MS = 10 * 60 * 1000;
/** Give up on an auction that still hasn't ended after this (relisted, extended). */
const PENDING_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_TRACKS_PER_USER = 25;
const MAX_SALES_PER_TRACK = 2000;
/** Upper bound on getItem calls per run, so a busy query can't drain the quota. */
const MAX_READBACKS_PER_RUN = 150;

const key = {
  tracks: (userId: string) => `research:sold:tracks:${userId}`,
  owners: 'research:sold:owners',
  pending: 'research:sold:pending',
  queued: (trackId: string) => `research:sold:queued:${trackId}`,
  // Bid count when queued: getItem stops reporting it once the auction ends.
  snap: (itemId: string) => `research:sold:snap:${itemId}`,
  sales: (trackId: string) => `research:sold:sales:${trackId}`,
  lock: 'research:sold:lock',
};

export class SoldTrackerService {
  constructor(private ebayService: EbayService, private redis: Redis) {}

  // -------------------------------------------------------------------------
  // Track management
  // -------------------------------------------------------------------------

  async createTrack(userId: string, input: SoldTrackInput): Promise<SoldTrack> {
    const existing = await this.redis.hlen(key.tracks(userId));
    if (existing >= MAX_TRACKS_PER_USER) {
      throw new RateLimitError(`At most ${MAX_TRACKS_PER_USER} sold-price tracks per user`);
    }
    const track: SoldTrack = {
      id: randomUUID(),
      userId,
      label: input.label ?? input.q,
      q: input.q,
      conditions: input.conditions ?? [],
      categoryIds: input.categoryIds ?? [],
      excludedKeywords: input.excludedKeywords ?? [],
      minPrice: input.minPrice ?? null,
      maxPrice: input.maxPrice ?? null,
      createdAt: new Date().toISOString(),
    };
    await this.redis
      .multi()
      .hset(key.tracks(userId), track.id, JSON.stringify(track))
      .sadd(key.owners, userId)
      .exec();
    return track;
  }

  async listTracks(userId: string): Promise<(SoldTrack & { sales: number })[]> {
    const raw = await this.redis.hvals(key.tracks(userId));
    const tracks: SoldTrack[] = raw.map((t) => JSON.parse(t));
    const counts = await Promise.all(tracks.map((t) => this.redis.llen(key.sales(t.id))));
    return tracks.map((t, i) => ({ ...t, sales: counts[i] }));
  }

  async deleteTrack(userId: string, trackId: string): Promise<boolean> {
    const removed = await this.redis.hdel(key.tracks(userId), trackId);
    if (removed) {
      await this.redis.del(key.sales(trackId), key.queued(trackId));
    }
    return removed > 0;
  }

  async getSales(userId: string, trackId: string, days = 90): Promise<SoldTrackSales> {
    const raw = await this.redis.hget(key.tracks(userId), trackId);
    if (!raw) throw new NotFoundError('Track not found');
    const track: SoldTrack = JSON.parse(raw);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const sales: AuctionSale[] = (await this.redis.lrange(key.sales(trackId), 0, -1))
      .map((s) => JSON.parse(s))
      .filter((s: AuctionSale) => Date.parse(s.endedAt) >= cutoff);
    const totals = sales.map((s) => s.total).filter((t): t is number => t != null);
    const { q1, q3 } = quartiles(totals);
    return {
      track,
      days,
      stats:
        totals.length > 0
          ? {
              n: totals.length,
              min: round(min(totals)),
              q1: round(q1),
              median: round(median(totals)),
              q3: round(q3),
              max: round(max(totals)),
            }
          : null,
      sales,
    };
  }

  // -------------------------------------------------------------------------
  // The periodic run
  // -------------------------------------------------------------------------

  /** Run now, then every SOLD_TRACKER_INTERVAL_MS. Returns the timer. */
  start(): NodeJS.Timeout {
    void this.runOnce();
    const timer = setInterval(() => void this.runOnce(), SOLD_TRACKER_INTERVAL_MS);
    timer.unref();
    return timer;
  }

  /** One pass: queue auctions about to end, then read back the ones that have. Never throws. */
  async runOnce(): Promise<{ queued: number; recorded: number; dropped: number }> {
    const result = { queued: 0, recorded: 0, dropped: 0 };
    // One runner at a time, even with several replicas or an overlapping run.
    const locked = await this.redis.set(key.lock, '1', 'PX', 30 * 60 * 1000, 'NX').catch(() => null);
    if (!locked) return result;

    try {
      for (const userId of await this.redis.smembers(key.owners)) {
        for (const raw of await this.redis.hvals(key.tracks(userId))) {
          result.queued += await this.queueEndingAuctions(JSON.parse(raw));
        }
      }
      const readback = await this.readBackEnded();
      result.recorded = readback.recorded;
      result.dropped = readback.dropped;
      if (result.queued || result.recorded) logger.info('sold_tracker.run', result);
    } catch (error) {
      if (error instanceof RateLimitError) {
        logger.warn('sold_tracker.quota_stop', { message: error.message });
      } else {
        logger.error('sold_tracker.run_failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      await this.redis.del(key.lock).catch(() => undefined);
    }
    return result;
  }

  /** Search the track's auctions ending within the lookahead and queue new ones. */
  private async queueEndingAuctions(track: SoldTrack): Promise<number> {
    const horizon = new Date(Date.now() + LOOKAHEAD_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const filter = [
      buildFilter({
        q: track.q,
        conditions: track.conditions,
        minPrice: track.minPrice,
        maxPrice: track.maxPrice,
        buyingOptions: ['AUCTION'],
      }),
      `itemEndDate:[..${horizon}]`,
    ].join(',');
    const params: Record<string, string | number> = {
      q: track.q,
      filter,
      sort: 'endingSoonest',
      limit: 200,
    };
    if (track.categoryIds[0]) params.category_ids = track.categoryIds[0];

    const raw = await this.ebayService.browseGet<any>('/item_summary/search', params);
    const excluded = exclusion(track.excludedKeywords);
    let queued = 0;
    for (const s of raw.itemSummaries ?? []) {
      if (!s.itemId || !s.itemEndDate || (excluded && excluded.test(s.title ?? ''))) continue;
      const fresh = await this.redis.sadd(key.queued(track.id), s.itemId);
      if (!fresh) continue;
      const checkAfter = Date.parse(s.itemEndDate) + SETTLE_MS;
      await this.redis.zadd(key.pending, checkAfter, `${track.userId}|${track.id}|${s.itemId}`);
      await this.redis.set(key.snap(s.itemId), String(s.bidCount ?? 0), 'PX', PENDING_MAX_AGE_MS);
      queued++;
    }
    // The dedupe set only needs to outlive the pending window.
    await this.redis.pexpire(key.queued(track.id), PENDING_MAX_AGE_MS * 2);
    return queued;
  }

  /** Read back auctions whose end has passed; record the ones that sold. */
  private async readBackEnded(): Promise<{ recorded: number; dropped: number }> {
    const due = await this.redis.zrangebyscore(key.pending, 0, Date.now(), 'LIMIT', 0, MAX_READBACKS_PER_RUN);
    let recorded = 0;
    let dropped = 0;
    for (const member of due) {
      // `<userId>|<trackId>|<itemId>`; item IDs contain pipes themselves (v1|123|0).
      const [userId, trackId, ...rest] = member.split('|');
      const itemId = rest.join('|');
      const trackRaw = await this.redis.hget(key.tracks(userId), trackId);
      if (!trackRaw) {
        await this.redis.zrem(key.pending, member);
        continue;
      }
      let item: any;
      try {
        item = await this.ebayService.browseGet<any>(`/item/${encodeURIComponent(itemId)}`, {});
      } catch (error) {
        if (error instanceof NotFoundError) {
          await this.redis.zrem(key.pending, member);
          dropped++;
          continue;
        }
        throw error;
      }

      const endedAt = item.itemEndDate ? Date.parse(item.itemEndDate) : NaN;
      if (!Number.isFinite(endedAt)) {
        await this.redis.zrem(key.pending, member);
        dropped++;
        continue;
      }
      if (endedAt > Date.now()) {
        // Not over yet (the end moved, e.g. relisted as a new run): check again at the
        // new end, unless that's implausibly far away.
        if (endedAt - Date.now() > PENDING_MAX_AGE_MS) {
          await this.redis.zrem(key.pending, member);
          dropped++;
        } else {
          await this.redis.zadd(key.pending, endedAt + SETTLE_MS, member);
        }
        continue;
      }

      await this.redis.zrem(key.pending, member);
      const bidsSeen = Number((await this.redis.get(key.snap(itemId))) ?? 0);
      const sale = toSale(item, bidsSeen);
      if (sale) {
        await this.redis
          .multi()
          .lpush(key.sales(trackId), JSON.stringify(sale))
          .ltrim(key.sales(trackId), 0, MAX_SALES_PER_TRACK - 1)
          .exec();
        recorded++;
      } else {
        dropped++;
      }
    }
    return { recorded, dropped };
  }
}

/**
 * An ended auction is a sale when eBay reports it sold. Checked live on
 * 2026-10-16: after the end, getItem drops `bidCount` and `buyingOptions`, keeps
 * `currentBidPrice` at the winning bid, and flips availability to OUT_OF_STOCK
 * with estimatedSoldQuantity 1. An auction that ended unsold stays IN_STOCK with 0 sold.
 */
export function toSale(item: any, bidsSeen = 0): AuctionSale | null {
  const availability = item.estimatedAvailabilities?.[0] ?? {};
  const sold =
    Number(availability.estimatedSoldQuantity ?? 0) >= 1 ||
    availability.estimatedAvailabilityStatus === 'OUT_OF_STOCK';
  if (!sold || item.reservePriceMet === false) return null;
  const price = num(item.currentBidPrice?.value) ?? num(item.price?.value);
  if (price == null) return null;
  const bids = Number(item.bidCount ?? bidsSeen);
  const shipping = num(item.shippingOptions?.[0]?.shippingCost?.value);
  return {
    itemId: item.itemId,
    legacyItemId: item.legacyItemId,
    title: item.title,
    url: `https://www.ebay.com/itm/${item.legacyItemId ?? ''}`,
    condition: item.condition,
    conditionId: item.conditionId,
    price,
    shipping,
    total: round(price + (shipping ?? 0)),
    bidCount: bids,
    endedAt: item.itemEndDate,
    seller: item.seller?.username,
  };
}

function exclusion(words: string[]): RegExp | null {
  const cleaned = words.map((w) => w.trim()).filter(Boolean);
  if (cleaned.length === 0) return null;
  return new RegExp(`\\b(?:${cleaned.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? 'NaN'));
  return Number.isFinite(n) ? n : null;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
