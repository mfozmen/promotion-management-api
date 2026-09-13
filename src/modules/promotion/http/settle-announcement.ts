import type { Announcement } from './announcement.js';

/**
 * Awaits one announcement step and swallows its failure.
 *
 * Each step is settled separately because a sequential chain lets the first
 * failure take the rest with it: a boundary call that times out would otherwise
 * skip the `promotion.changed` behind it and leave a cancelled sale priced on
 * the storefront.
 */
export async function settleAnnouncement(
  work: Promise<unknown>,
  promotionId: number,
  deps: Announcement,
): Promise<void> {
  try {
    await work;
  } catch (error) {
    deps.log.error(
      { promotionId, error: { message: error instanceof Error ? error.message : 'unknown' } },
      'a promotion change could not be announced; the read model stays stale until this promotion changes again',
    );
  }
}
