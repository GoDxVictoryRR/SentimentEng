/**
 * RSS Feed Parser
 * Parses XML RSS 2.0 / Atom feeds into normalized InputArticle objects.
 * Uses browser-native DOMParser — no external XML library needed.
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
    // US Eastern: pre-market 4am-9:30am ET ≈ 9:00-14:30 UTC
    if (utcHour >= 9 && utcHour < 14) return 'PRE_MARKET';
    // Market hours 9:30am-4pm ET ≈ 14:30-21:00 UTC
    if (utcHour >= 14 && utcHour < 21) return 'MARKET_HOURS';
    return 'AFTER_HOURS';
}

/**
 * Strips HTML tags from text content (RSS descriptions often contain HTML).
 */
function stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

/**
 * Parses a raw RSS/Atom XML string into InputArticle objects.
 */
export function parseRSSFeed(xmlText: string, source: FeedSource): InputArticle[] {
    const articles: InputArticle[] = [];

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, 'text/xml');

        // Check for parse errors
        const parseError = doc.querySelector('parsererror');
        if (parseError) {
            console.warn(`[RSS Parser] XML parse error for ${source.name}`);
            return [];
        }

        // RSS 2.0 items
        const rssItems = doc.querySelectorAll('item');
        // Atom entries
        const atomEntries = doc.querySelectorAll('entry');

        const items = rssItems.length > 0 ? rssItems : atomEntries;

        items.forEach((item) => {
            try {
                const headline = item.querySelector('title')?.textContent?.trim() ?? '';
                if (!headline) return; // Skip items with no title

                const description = item.querySelector('description')?.textContent
                    ?? item.querySelector('summary')?.textContent
                    ?? item.querySelector('content')?.textContent
                    ?? '';

                const pubDate = item.querySelector('pubDate')?.textContent
                    ?? item.querySelector('published')?.textContent
                    ?? item.querySelector('updated')?.textContent
                    ?? new Date().toISOString();

                const link = item.querySelector('link')?.textContent
                    ?? item.querySelector('link')?.getAttribute('href')
                    ?? '';

                articles.push({
                    article_id: uuidv4(),
                    source: source.name,
                    source_tier: source.tier,
                    source_weight: source.weight,
                    source_category: source.category,
                    headline: stripHtml(headline),
                    summary: stripHtml(description).slice(0, 500),
                    body: null, // RSS feeds typically only provide summaries
                    published_at: new Date(pubDate).toISOString(),
                    feed_url: source.url,
                    market_session: getMarketSession(),
                    schema_version: SCHEMA_VERSION,
                });
            } catch (e) {
                // Skip malformed items silently
            }
        });
    } catch (e) {
        console.error(`[RSS Parser] Failed to parse feed: ${source.name}`, e);
    }

    return articles;
}
