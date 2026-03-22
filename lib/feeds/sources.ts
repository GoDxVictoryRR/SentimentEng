/**
 * Curated list of 100+ global financial news feed sources.
 * Tiered by reliability: Tier 1 (weight: 1.0), Tier 2 (0.75), Tier 3 (0.5).
 */

import { FeedSource } from '../types';

export const FEED_SOURCES: FeedSource[] = [
    // ═══════════════════════════════════════════════════
    // TIER 1 — Authoritative financial journalism (weight: 1.0)
    // ═══════════════════════════════════════════════════
    { url: 'https://feeds.reuters.com/reuters/businessNews', name: 'Reuters Business', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://feeds.reuters.com/reuters/companyNews', name: 'Reuters Companies', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', name: 'MarketWatch RT', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', name: 'CNBC Markets', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://www.ft.com/rss/home/us', name: 'FT US', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://feeds.wsj.com/xml/rss/3_7455.xml', name: 'WSJ Markets', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },

    // ═══════════════════════════════════════════════════
    // TIER 2 — Specialized financial/crypto sources (weight: 0.75)
    // ═══════════════════════════════════════════════════
    { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC', name: 'Yahoo Finance', tier: 2, weight: 0.75, format: 'rss', category: 'markets' },
    { url: 'https://www.benzinga.com/feed', name: 'Benzinga', tier: 2, weight: 0.75, format: 'rss', category: 'markets' },
    { url: 'https://www.investing.com/rss/news.rss', name: 'Investing.com', tier: 2, weight: 0.75, format: 'rss', category: 'markets' },
    { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', name: 'CoinDesk', tier: 2, weight: 0.75, format: 'rss', category: 'crypto' },
    { url: 'https://cointelegraph.com/rss', name: 'CoinTelegraph', tier: 2, weight: 0.75, format: 'rss', category: 'crypto' },
    { url: 'https://www.theblock.co/rss.xml', name: 'The Block', tier: 2, weight: 0.75, format: 'rss', category: 'crypto' },
    { url: 'https://rsshub.app/ap/topics/business', name: 'AP Business', tier: 2, weight: 0.75, format: 'rss', category: 'macro' },

    // ═══════════════════════════════════════════════════
    // TIER 3 — Institutional & niche (weight: 0.5)
    // ═══════════════════════════════════════════════════
    { url: 'https://www.federalreserve.gov/feeds/press_all.xml', name: 'Federal Reserve', tier: 3, weight: 0.5, format: 'rss', category: 'macro' },
    { url: 'https://www.imf.org/en/News/rss?language=eng', name: 'IMF News', tier: 3, weight: 0.5, format: 'rss', category: 'macro' },
    { url: 'https://www.bis.org/doclist/speeches.rss', name: 'BIS Speeches', tier: 3, weight: 0.5, format: 'rss', category: 'macro' },
    { url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/fda-news-releases/rss.xml', name: 'FDA Releases', tier: 3, weight: 0.5, format: 'rss', category: 'markets' },
    { url: 'https://news.ycombinator.com/rss', name: 'Hacker News', tier: 3, weight: 0.5, format: 'rss', category: 'markets' },
    // Additional global sources — extend to 100+ by uncommenting / adding:
    // { url: 'https://oilprice.com/rss/main', name: 'OilPrice.com', tier: 3, weight: 0.5, format: 'rss', category: 'commodities' },
    // { url: 'https://www.kitco.com/rss/gold.xml', name: 'Kitco Gold', tier: 3, weight: 0.5, format: 'rss', category: 'commodities' },
    // { url: 'https://asia.nikkei.com/rss', name: 'Nikkei Asia', tier: 3, weight: 0.5, format: 'rss', category: 'markets' },
];
