/**
 * Fetcher Worker — registered as 'sentiment-fetcher'
 * Fetches a group of RSS/JSON feeds, parses them into articles,
 * and stores results in KV for the pipeline worker to consume.
 * Respects circuit breakers and uses exponential backoff.
 */

/* global puter */

// ── Inline KV helpers ──
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

// ── Inline Backoff ──
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withBackoff(fn, maxRetries = 3) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try { return await fn(); }
        catch (err) {
            lastError = err;
            if (attempt < maxRetries) {
                const delay = Math.min(1000 * Math.pow(2, attempt), 15000) + Math.random() * 500;
                await sleep(delay);
            }
        }
    }
    throw lastError;
}

// ── Inline Circuit Breaker ──
function hashUrl(url) {
    let h = 0;
    for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
}

async function isCircuitOpen(sourceUrl) {
    const state = await kvGet(`cb:${hashUrl(sourceUrl)}`);
    if (!state || !state.tripped) return false;
    if (state.retry_after && Date.now() > new Date(state.retry_after).getTime()) {
        await kvSet(`cb:${hashUrl(sourceUrl)}`, { ...state, tripped: false, consecutive_failures: 0 });
        return false;
    }
    return true;
}

async function recordSuccess(sourceUrl) {
    await kvSet(`cb:${hashUrl(sourceUrl)}`, {
        source_url: sourceUrl, consecutive_failures: 0, tripped: false,
        tripped_at: null, retry_after: null, schema_version: '1.3',
    });
}

async function recordFailure(sourceUrl) {
    const state = await kvGet(`cb:${hashUrl(sourceUrl)}`) ?? {
        source_url: sourceUrl, consecutive_failures: 0, tripped: false,
        tripped_at: null, retry_after: null, schema_version: '1.3',
    };
    const failures = state.consecutive_failures + 1;
    const shouldTrip = failures >= 5;
    await kvSet(`cb:${hashUrl(sourceUrl)}`, {
        ...state, consecutive_failures: failures, tripped: shouldTrip,
        tripped_at: shouldTrip ? new Date().toISOString() : state.tripped_at,
        retry_after: shouldTrip ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null,
        schema_version: '1.3',
    });
}

// ── Inline RSS Parser ──
function stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}

function getMarketSession() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    const day = now.getUTCDay();
    if (day === 0 || day === 6) return 'WEEKEND';
    if (utcHour >= 9 && utcHour < 14) return 'PRE_MARKET';
    if (utcHour >= 14 && utcHour < 21) return 'MARKET_HOURS';
    return 'AFTER_HOURS';
}

function generateId() {
    return 'art_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

function parseFeed(xmlText, source) {
    const articles = [];
    try {
        // Simple regex-based RSS/Atom parser for headless environments (no DOMParser)
        const itemRegex = /<(item|entry)>([\s\S]*?)<\/\1>/gi;

        let match;
        while ((match = itemRegex.exec(xmlText)) !== null) {
            const content = match[2];

            // Extract fields using regex to avoid DOM dependency
            const getTag = (tag) => {
                const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
                const m = regex.exec(content);
                return m ? m[1].trim() : null;
            };

            const headline = getTag('title') ?? '';
            if (!headline) continue;

            const description = getTag('description') ?? getTag('summary') ?? getTag('content') ?? '';
            const pubDate = getTag('pubDate') ?? getTag('published') ?? getTag('updated') ?? new Date().toISOString();

            articles.push({
                article_id: generateId(),
                source: source.name,
                source_tier: source.tier,
                source_weight: source.weight,
                source_category: source.category,
                headline: stripHtml(headline),
                summary: stripHtml(description).slice(0, 500),
                body: null,
                published_at: new Date(pubDate).toISOString(),
                feed_url: source.url,
                market_session: getMarketSession(),
                schema_version: '1.3',
            });
        }
    } catch (e) {
        console.error(`[Fetcher] Parse error using regex: ${source.name}`, e);
    }
    return articles;
}

// ── Register Worker ──
puter.workers.register('sentiment-fetcher', async ({ cycleId, groupIndex, feeds }) => {
    const articles = [];

    for (const feed of feeds) {
        if (await isCircuitOpen(feed.url)) {
            console.log(`[Fetcher] Circuit open, skipping: ${feed.name}`);
            continue;
        }

        try {
            const raw = await withBackoff(async () => {
                const controller = new AbortController();
                const timeout = setTimeout(() => controller.abort(), 10000);
                try {
                    const resp = await fetch(feed.url, {
                        signal: controller.signal,
                        headers: { 'User-Agent': 'SentimentLiquidityEngine/1.4' },
                    });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    return await resp.text();
                } finally {
                    clearTimeout(timeout);
                }
            });
            await recordSuccess(feed.url);
            const parsed = parseFeed(raw, feed);
            articles.push(...parsed);
            console.log(`[Fetcher] ✓ ${feed.name}: ${parsed.length} articles`);
        } catch (e) {
            await recordFailure(feed.url);
            console.error(`[Fetcher] ✗ ${feed.name}:`, e.message);
        }
    }

    // Store results in KV for the pipeline worker to pick up
    await kvSet(`queue:raw:${cycleId}:${groupIndex}`, articles, 600);

    // Atomically increment done counter
    await puter.kv.incr(`manager:cycle:${cycleId}:done`);

    console.log(`[Fetcher] Group ${groupIndex} complete — ${articles.length} articles queued.`);
    return { groupIndex, articleCount: articles.length };
});
