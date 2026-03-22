/**
 * JSON Feed Parser
 * Parses JSON-formatted news feeds (e.g., custom API responses, JSON Feed 1.1).
 */

import { InputArticle, FeedSource, SCHEMA_VERSION } from '../types';
import { v4 as uuidv4 } from 'uuid';

/**
 * Determines the current market session based on UTC hour.
 */
function getMarketSession(): InputArticle['market_session'] {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const day = now.getUTCDay();

    if (day === 0 || day === 6) return 'WEEKEND';
    if (utcHour >= 9 && utcHour < 14) return 'PRE_MARKET';
    if (utcHour >= 14 && utcHour < 21) return 'MARKET_HOURS';
    return 'AFTER_HOURS';
}

/**
 * Parses a JSON feed response into InputArticle objects.
 * Supports JSON Feed 1.1 spec and common custom API formats.
 */
export function parseJSONFeed(jsonText: string, source: FeedSource): InputArticle[] {
    const articles: InputArticle[] = [];

    try {
        const data = JSON.parse(jsonText);

        // JSON Feed 1.1 spec: items array at top level
        const items: any[] = data.items ?? data.articles ?? data.results ?? data.data ?? [];

        if (!Array.isArray(items)) {
            console.warn(`[JSON Parser] No items array found for ${source.name}`);
            return [];
        }

        for (const item of items) {
            try {
                const headline = item.title ?? item.headline ?? '';
                if (!headline) continue;

                const summary = item.summary ?? item.content_text ?? item.description ?? item.content ?? '';
                const body = item.content_html ?? item.body ?? item.content ?? null;
                const publishedAt = item.date_published ?? item.published_at ?? item.pubDate ?? item.date ?? new Date().toISOString();

                articles.push({
                    article_id: uuidv4(),
                    source: source.name,
                    source_tier: source.tier,
                    source_weight: source.weight,
                    source_category: source.category,
                    headline: headline.trim(),
                    summary: (typeof summary === 'string' ? summary : '').slice(0, 500),
                    body: typeof body === 'string' ? body : null,
                    published_at: new Date(publishedAt).toISOString(),
                    feed_url: source.url,
                    market_session: getMarketSession(),
                    schema_version: SCHEMA_VERSION,
                });
            } catch (e) {
                // Skip malformed items
            }
        }
    } catch (e) {
        console.error(`[JSON Parser] Failed to parse feed: ${source.name}`, e);
    }

    return articles;
}
