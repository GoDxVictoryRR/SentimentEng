/**
 * Manager Worker — registered as 'sentiment-manager'
 * Orchestrates the fan-out of feed fetchers and triggers the pipeline worker.
 * Uses puter.workers.execute() — NOT HTTP fetch, NOT .run()
 */

/* global puter, crypto */

// Inline helpers (workers run in isolated contexts)
async function kvGet(key) {
    try {
        const raw = await puter.kv.get(key);
        if (!raw) return null;
        const entry = JSON.parse(raw);
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            await puter.kv.del(key);
            return null;
        }
        return entry.value;
    } catch { return null; }
}

async function kvSet(key, value, ttlSeconds) {
    const entry = {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
        schema_version: '1.3',
    };
    await puter.kv.set(key, JSON.stringify(entry));
}

// Helper for atomic counters (no JSON wrapping)
async function kvSetRaw(key, value) {
    await puter.kv.set(key, String(value));
}

function chunkArray(arr, chunkSize) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += chunkSize) {
        chunks.push(arr.slice(i, i + chunkSize));
    }
    return chunks;
}

// Import feed sources inline (workers are self-contained)
const FEED_SOURCES = [
    { url: 'https://feeds.reuters.com/reuters/businessNews', name: 'Reuters Business', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://feeds.reuters.com/reuters/companyNews', name: 'Reuters Companies', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', name: 'MarketWatch RT', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', name: 'CNBC Markets', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://www.ft.com/rss/home/us', name: 'FT US', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://feeds.wsj.com/xml/rss/3_7455.xml', name: 'WSJ Markets', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
    { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC', name: 'Yahoo Finance', tier: 2, weight: 0.75, format: 'rss', category: 'markets' },
    { url: 'https://www.benzinga.com/feed', name: 'Benzinga', tier: 2, weight: 0.75, format: 'rss', category: 'markets' },
    { url: 'https://www.investing.com/rss/news.rss', name: 'Investing.com', tier: 2, weight: 0.75, format: 'rss', category: 'markets' },
    { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', name: 'CoinDesk', tier: 2, weight: 0.75, format: 'rss', category: 'crypto' },
    { url: 'https://cointelegraph.com/rss', name: 'CoinTelegraph', tier: 2, weight: 0.75, format: 'rss', category: 'crypto' },
    { url: 'https://www.theblock.co/rss.xml', name: 'The Block', tier: 2, weight: 0.75, format: 'rss', category: 'crypto' },
    { url: 'https://rsshub.app/ap/topics/business', name: 'AP Business', tier: 2, weight: 0.75, format: 'rss', category: 'macro' },
    { url: 'https://www.federalreserve.gov/feeds/press_all.xml', name: 'Federal Reserve', tier: 3, weight: 0.5, format: 'rss', category: 'macro' },
    { url: 'https://www.imf.org/en/News/rss?language=eng', name: 'IMF News', tier: 3, weight: 0.5, format: 'rss', category: 'macro' },
    { url: 'https://www.bis.org/doclist/speeches.rss', name: 'BIS Speeches', tier: 3, weight: 0.5, format: 'rss', category: 'macro' },
    { url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/fda-news-releases/rss.xml', name: 'FDA Releases', tier: 3, weight: 0.5, format: 'rss', category: 'markets' },
    { url: 'https://news.ycombinator.com/rss', name: 'Hacker News', tier: 3, weight: 0.5, format: 'rss', category: 'markets' },
];

const N_FETCHER_WORKERS = 10;
const POLL_INTERVAL_MS = 30000;

// ── Helper to get or create a worker and return its URL ──
async function getWorkerUrl(name, filePath) {
    try {
        const info = await puter.workers.get(name);
        if (info?.url) return info.url;
    } catch (e) {
        // Worker doesn't exist, create it
    }
    try {
        const result = await puter.workers.create(name, filePath);
        console.log(`[Manager] Created worker: ${name} at ${result?.url}`);
        return result?.url;
    } catch (e) {
        console.error(`[Manager] Failed to create worker ${name}:`, e.message);
        return null;
    }
}

// ── Call a worker by URL with a JSON payload ──
async function callWorker(url, payload) {
    const resp = await puter.workers.exec(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    return resp;
}

// ── Register as a named Puter worker ──
puter.workers.register('sentiment-manager', async (payload) => {
    const { prewarm = false } = payload ?? {};

    // Anti-spam guard: don't run if last cycle was < 30s ago
    const lastRun = await kvGet('poller:last_run');
    if (!prewarm && lastRun && Date.now() - lastRun < POLL_INTERVAL_MS) {
        console.log('[Manager] Skipping — last cycle was less than 30s ago.');
        return { status: 'skipped', reason: 'cooldown' };
    }
    await kvSet('poller:last_run', Date.now());

    // Resolve fetcher and pipeline worker URLs
    const fetcherUrl = await getWorkerUrl('sentiment-fetcher', '/Desktop/fetcher.js');
    const pipelineUrl = await getWorkerUrl('sentiment-pipeline', '/Desktop/pipeline.js');

    if (!fetcherUrl || !pipelineUrl) {
        console.error('[Manager] Could not resolve worker URLs');
        return { status: 'error', reason: 'worker_urls_missing' };
    }

    // Generate a stable cycle ID
    const cycleId = 'cycle_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
    const groups = chunkArray(FEED_SOURCES, Math.ceil(FEED_SOURCES.length / N_FETCHER_WORKERS));

    console.log(`[Manager] Starting cycle ${cycleId} — ${groups.length} fetcher groups.`);

    // Store expected count for the pipeline worker to poll
    await kvSet(`manager:cycle:${cycleId}:expected`, groups.length, 600);

    // ATOMIC: Initialize counter as raw string for puter.kv.incr()
    await kvSetRaw(`manager:cycle:${cycleId}:done`, 0);

    // Fan out to fetcher workers via URL
    await Promise.allSettled(
        groups.map((group, i) =>
            callWorker(fetcherUrl, { cycleId, groupIndex: i, feeds: group })
                .catch(e => console.error(`[Manager] Fetcher group ${i} failed:`, e.message))
        )
    );

    // Trigger pipeline worker to collect and process results
    await callWorker(pipelineUrl, { cycleId })
        .catch(e => console.error('[Manager] Pipeline call failed:', e.message));

    return { status: 'ok', cycleId, groups: groups.length };
});
