/**
 * Feed Ingestion Coordinator
 * Fetches and parses feeds using the appropriate parser, with circuit-breaker
 * and backoff protection on every source.
 */

import { InputArticle, FeedSource } from '../types';
import { parseRSSFeed } from './rss-parser';
import { parseJSONFeed } from './json-parser';
import { FEED_SOURCES } from './sources';
import { isCircuitOpen, recordSuccess, recordFailure } from '../resilience/circuit-breaker';
import { withBackoff } from '../resilience/backoff';

/**
 * Fetches a raw feed from a URL. Runs inside backoff.
 */
async function fetchFeedRaw(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'SentimentLiquidityEngine/1.4' },
        });
        if (!response.ok) {
            const err: any = new Error(`HTTP ${response.status}`);
            err.status = response.status;
            throw err;
        }
        return await response.text();
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Parses raw feed text using the appropriate parser based on format.
 */
function parseFeed(rawText: string, source: FeedSource): InputArticle[] {
    if (source.format === 'json') {
        return parseJSONFeed(rawText, source);
    }
    return parseRSSFeed(rawText, source);
}

/**
 * Fetches and parses a list of feed sources, respecting circuit breakers.
 * Returns all successfully parsed articles.
 */
export async function fetchFeeds(feeds: FeedSource[]): Promise<InputArticle[]> {
    const articles: InputArticle[] = [];

    for (const feed of feeds) {
        // Circuit breaker check — skip sources that have failed repeatedly
        if (await isCircuitOpen(feed.url)) {
            console.log(`[FeedIndex] Circuit open, skipping: ${feed.name}`);
            continue;
        }

        try {
            const raw = await withBackoff(() => fetchFeedRaw(feed.url));
            await recordSuccess(feed.url);
            const parsed = parseFeed(raw, feed);
            articles.push(...parsed);
            console.log(`[FeedIndex] ✓ ${feed.name}: ${parsed.length} articles`);
        } catch (e) {
            await recordFailure(feed.url);
            console.error(`[FeedIndex] ✗ ${feed.name}:`, (e as Error).message);
        }
    }

    return articles;
}

/**
 * Utility: split an array into N chunks for fan-out to workers.
 */
export function chunkArray<T>(arr: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
}

export { FEED_SOURCES };
