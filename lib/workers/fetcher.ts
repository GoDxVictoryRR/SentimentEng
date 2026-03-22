/**
 * Fetcher Coordinator (TypeScript library version)
 * Used by lib/ code that imports fetcher logic.
 * The actual worker registration is in puter-worker/fetcher.js.
 */

import { InputArticle, FeedSource } from '../types';
import { fetchFeeds } from '../feeds';
import { kvSet } from '../cache/kv';

declare const puter: any;

/**
 * Fetches feeds for a given group and stores results in KV.
 */
export async function fetchAndStore(
    cycleId: string,
    groupIndex: number,
    feeds: FeedSource[]
): Promise<number> {
    const articles = await fetchFeeds(feeds);

    // Store results for pipeline worker
    await kvSet(`queue:raw:${cycleId}:${groupIndex}`, articles, 600);

    // Atomically increment done counter
    await puter.kv.incr(`manager:cycle:${cycleId}:done`);

    return articles.length;
}
