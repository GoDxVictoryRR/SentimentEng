/**
 * Pipeline Worker — registered as 'sentiment-pipeline'
 * Polls KV until all fetcher workers have completed, then
 * runs the full Stage 0→5 pipeline on all collected articles.
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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Inline AI helpers (all calls via puter.ai — zero developer API keys) ──
async function puterChat(model, messages, options = {}) {
    const response = await puter.ai.chat(model, messages, {
        temperature: options.temperature ?? 0.0,
        response_format: options.jsonMode ? { type: 'json_object' } : undefined,
    });
    return response.message.content;
}

async function puterEmbed(text) {
    const result = await puter.ai.embed(text.slice(0, 500));
    return result.embedding;
}

function cosineSimilarity(a, b) {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]; magA += a[i] * a[i]; magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function parseJSON(raw) {
    try {
        return JSON.parse(raw);
    } catch (e) {
        let text = raw.trim();
        if (text.startsWith("```json")) text = text.replace(/^```json/, "").replace(/```$/, "").trim();
        else if (text.startsWith("```")) text = text.replace(/^```/, "").replace(/```$/, "").trim();
        const startObj = text.indexOf('{'), endObj = text.lastIndexOf('}');
        const startArr = text.indexOf('['), endArr = text.lastIndexOf(']');
        if (startObj !== -1 && endObj !== -1 && (startArr === -1 || startObj < startArr)) {
            return JSON.parse(text.slice(startObj, endObj + 1));
        }
        if (startArr !== -1 && endArr !== -1) {
            return JSON.parse(text.slice(startArr, endArr + 1));
        }
        throw e;
    }
}

// ── Ticker validation ──
function isValidTicker(ticker) {
    if (!ticker || typeof ticker !== 'string') return false;
    const upper = ticker.toUpperCase().trim();
    if (upper.length < 1 || upper.length > 15) return false;
    if (!/^[A-Z0-9.\-:]+$/.test(upper)) return false;
    if (['INC', 'LTD', 'CORP', 'CO', 'PLC', 'THE', 'AND'].includes(upper)) return false;
    return true;
}

// ── STAGE 0: Dedup ──
const MAX_TS = Number.MAX_SAFE_INTEGER;
const SEMANTIC_THRESHOLD = 0.92;

async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function deduplicate(article) {
    const exactHash = await sha256(article.headline + article.published_at);
    if (await kvGet(`hash:${exactHash}`)) return 'EXACT_HIT';
    await kvSet(`hash:${exactHash}`, '1', 172800);

    if (['markets', 'macro'].includes(article.source_category)) {
        try {
            const embedding = await puterEmbed(article.headline);
            if (!embedding) return 'MISS';

            const allKeys = await puter.kv.list('semhash:');
            const recentKeys = (allKeys ?? []).slice(0, 200);

            for (const key of recentKeys) {
                const stored = await kvGet(key);
                if (!stored) continue;
                if (cosineSimilarity(embedding, stored.embedding) >= SEMANTIC_THRESHOLD) {
                    console.log(`[Pipeline] Semantic Dedup Hit: ${article.headline}`);
                    return 'SEMANTIC_HIT';
                }
            }

            const decreasingTs = MAX_TS - Date.now();
            const paddedTs = String(decreasingTs).padStart(16, '0');
            const embHash = Math.abs(embedding.slice(0, 4).reduce((a, b) => a + Math.round(b * 100), 0)).toString(36).slice(0, 12);
            await kvSet(`semhash:${paddedTs}:${embHash}`, { embedding, article_id: article.article_id }, 172800);
        } catch (e) {
            console.warn('[Pipeline] Stage 0 error:', e.message);
        }
    }
    return 'MISS';
}

// ── STAGE 1: Pre-filter ──
const PREFILTER_PROMPT = `You are a financial news relevance classifier. Classify each article as financially relevant (true) or irrelevant (false). Return ONLY valid JSON: { "results": [ { "article_id": "string", "relevant": true | false } ] }`;

async function batchPrefilter(articles) {
    const BATCH = 16;
    const relevant = [];
    for (let i = 0; i < articles.length; i += BATCH) {
        const batch = articles.slice(i, i + BATCH);
        const payload = JSON.stringify(batch.map(a => ({ article_id: a.article_id, headline: a.headline, summary: (a.summary ?? '').slice(0, 200) })));
        try {
            console.log(`[Pipeline] Pre-filtering ${batch.length} articles...`);
            const raw = await puterChat('gpt-4o-mini', [{ role: 'user', content: `${PREFILTER_PROMPT}\n\nArticles:\n${payload}` }], { jsonMode: true });
            const parsed = parseJSON(raw);
            for (const r of (parsed.results ?? [])) {
                if (r.relevant) {
                    const art = batch.find(a => a.article_id === r.article_id);
                    if (art) relevant.push(art);
                }
            }
        } catch (e) {
            console.warn(`[Pipeline] Pre-filter error: ${e.message}`);
            relevant.push(...batch); // Conservative fallback
        }
    }
    return relevant;
}

// ── STAGE 2a: NER ──
async function runNER(article) {
    const prompt = `You are a financial NER engine. Extract entities with tickers from this article. Return ONLY JSON: { "entities": [{ "name": "string", "ticker": "string|null", "entity_type": "COMPANY|INDEX|COMMODITY|CRYPTO|MACRO|ETF|UNKNOWN", "mention_count": 1, "primary": true, "surrounding_context": "10 word snippet" }] }\nHEADLINE: ${article.headline}\nBODY: ${(article.body ?? article.summary).slice(0, 2000)}`;
    try {
        const raw = await puterChat('gpt-4o-mini', [{ role: 'user', content: prompt }], { jsonMode: true });
        return (parseJSON(raw).entities ?? []).filter(e => !e.ticker || isValidTicker(e.ticker));
    } catch (e) {
        console.warn(`[Pipeline] NER failed: ${e.message}`);
        return [];
    }
}

// ── STAGE 2b: Disambiguation ──
const FINANCIAL_KEYWORDS = ['stock', 'share', 'equity', 'nasdaq', 'nyse', 'earnings', 'revenue', 'profit', 'analyst', 'upgrade', 'downgrade', 'dividend', 'acquisition', 'merger', 'ipo', 'market cap', 'trading volume', 'quarterly', 'ceo', 'investors'];
const AMBIGUOUS = { AAPL: 1, AMZN: 1, GOOGL: 1, META: 1, SNAP: 1, UBER: 1, LYFT: 1, PINS: 1, GOLD: 1, VALE: 1 };

function disambiguate(entities, text) {
    const lower = text.toLowerCase();
    return entities.filter(e => {
        if (!e.ticker) return false;
        if (!(e.ticker in AMBIGUOUS)) return true;
        const ctx = ((e.surrounding_context ?? '') + ' ' + lower).toLowerCase();
        const hits = FINANCIAL_KEYWORDS.filter(kw => ctx.includes(kw)).length;
        return hits >= 1;
    }).map(e => ({ ...e, disambiguation_passed: true, financial_context_score: 1 }));
}

// ── STAGE 3: Sentiment ──
async function runSentiment(article, entities) {
    const entList = JSON.stringify(entities.map(e => ({ ticker: e.ticker, name: e.name, primary: e.primary })));
    const prompt = `You are a quantitative financial sentiment analyzer. Score sentiment for each entity. Return ONLY JSON: { "scores": [{ "ticker": "string", "sentiment_score": <-1 to 1>, "confidence": <0 to 1>, "signal_type": "EARNINGS|ANALYST|REGULATORY|MA|MACRO|GEOPOLITICAL|SUPPLY_CHAIN|MANAGEMENT|PRODUCT|LEGAL|OTHER", "time_horizon": "INTRADAY|SHORT_TERM|MEDIUM_TERM|LONG_TERM", "reasoning_tag": "3-8 words" }], "market_regime": "RISK_ON|RISK_OFF|NEUTRAL" }\nEntities: ${entList}\nHEADLINE: ${article.headline}\nBODY: ${(article.body ?? article.summary).slice(0, 2000)}`;
    try {
        const raw = await puterChat('gpt-4o-mini', [{ role: 'user', content: prompt }], { jsonMode: true });
        const parsed = parseJSON(raw);
        return {
            scores: (parsed.scores ?? []).filter(s => isValidTicker(s.ticker) && Math.abs(s.sentiment_score) <= 1),
            regime: parsed.market_regime ?? 'NEUTRAL',
        };
    } catch (e) {
        console.warn(`[Pipeline] Sentiment failed: ${e.message}`);
        return { scores: [], regime: 'NEUTRAL' };
    }
}

// ── STAGE 4: EWMA ──
const LAMBDA = 0.94;

async function acquireLock(ticker) {
    const key = `lock:${ticker}`;
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
        const count = await puter.kv.incr(key);
        if (count === 1) {
            await kvSet(`lock:meta:${ticker}`, { acquired_at: Date.now() }, 5);
            return true;
        }
        await puter.kv.decr(key);
        const meta = await kvGet(`lock:meta:${ticker}`);
        if (!meta) { await puter.kv.del(key); continue; }
        await sleep(75 + Math.random() * 50);
    }
    return false;
}

async function releaseLock(ticker) {
    await puter.kv.del(`lock:${ticker}`);
    await puter.kv.del(`lock:meta:${ticker}`);
}

async function updateSL(ticker, score, sourceWeight, session, ts) {
    const locked = await acquireLock(ticker);
    if (!locked) { console.warn(`[Pipeline] Lock timeout for ${ticker}`); return null; }
    try {
        const prev = await kvGet(`sl:${ticker}`) ?? {
            ticker, ewma: 0, sentiment_liquidity_score: 0, volatility: 0, momentum: 0,
            article_signal_strength: 0, n: 0, lastUpdated: ts, regime: 'NEUTRAL',
            market_session: session, schema_version: '1.3',
        };
        const w = score.sentiment_score * score.confidence * sourceWeight;
        const ewma = LAMBDA * prev.ewma + (1 - LAMBDA) * w;
        const variance = LAMBDA * (prev.volatility ** 2) + (1 - LAMBDA) * Math.pow(w - ewma, 2);
        const updated = {
            ticker, sentiment_liquidity_score: +(ewma ?? 0).toFixed(4), ewma: +(ewma ?? 0).toFixed(4),
            volatility: +(Math.sqrt(Math.max(0, variance)) ?? 0).toFixed(4),
            momentum: prev.n === 0 ? 0 : +((ewma - prev.ewma) ?? 0).toFixed(4),
            article_signal_strength: +((score.confidence * Math.abs(score.sentiment_score) * sourceWeight) ?? 0).toFixed(4),
            n: prev.n + 1, lastUpdated: ts,
            regime: ewma > 0.15 ? 'RISK_ON' : ewma < -0.15 ? 'RISK_OFF' : 'NEUTRAL',
            market_session: session, schema_version: '1.3',
        };
        await kvSet(`sl:${ticker}`, updated);
        return updated;
    } finally { await releaseLock(ticker); }
}

// ── STAGE 5: Snapshot ──
function snapshotKey(ticker) {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `sl:history:${ticker}:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}`;
}

// ── Full Article Processor ──
async function processArticle(article) {
    const ts = new Date().toISOString();

    const dedup = await deduplicate(article);
    if (dedup !== 'MISS') return;

    const entities = await runNER(article);
    if (entities.length === 0) return;

    const valid = disambiguate(entities, article.body ?? article.summary ?? article.headline);
    if (valid.length === 0) return;

    const { scores, regime } = await runSentiment(article, valid);
    if (scores.length === 0) return;

    for (const score of scores) {
        if (score.confidence < 0.6) continue;
        const updated = await updateSL(score.ticker, score, article.source_weight, article.market_session, ts);
        if (updated) {
            const key = snapshotKey(score.ticker);
            const existing = await kvGet(key);
            if (!existing) await kvSet(key, updated, 259200);
        }
    }

    // Update watchlist
    const watchlist = await kvGet('watchlist:global') ?? [];
    const tickers = scores.map(s => s.ticker);
    const unique = [...new Set([...watchlist, ...tickers])];
    await kvSet('watchlist:global', unique, 86400);
}

// ── Concurrent Processor ──
async function processConcurrently(articles, concurrency = 10) {
    const queue = [...articles];
    const active = [];
    while (queue.length > 0 || active.length > 0) {
        while (active.length < concurrency && queue.length > 0) {
            const art = queue.shift();
            const p = processArticle(art).catch(e => console.error(`[Pipeline] Failed: ${art.headline}`, e.message))
                .then(() => { const i = active.indexOf(p); if (i > -1) active.splice(i, 1); });
            active.push(p);
        }
        if (active.length > 0) await Promise.race(active);
    }
}

// ── Register Worker ──
puter.workers.register('sentiment-pipeline', async ({ cycleId }) => {
    console.log(`[Pipeline] Starting pipeline for cycle ${cycleId}`);
    const cycleStart = Date.now();

    // Wait for all fetchers to complete (poll KV)
    const expected = await kvGet(`manager:cycle:${cycleId}:expected`) ?? 0;
    const deadline = Date.now() + 45000; // 45s max wait

    while (Date.now() < deadline) {
        // For the done counter, we read it via raw get since it was incremented with native incr()
        let done = 0;
        try {
            const raw = await puter.kv.get(`manager:cycle:${cycleId}:done`);
            done = parseInt(raw) || 0;
        } catch { done = 0; }
        if (done >= expected) break;
        await sleep(500);
    }

    // Collect all queued articles
    const allArticles = [];
    for (let i = 0; i < expected; i++) {
        const batch = await kvGet(`queue:raw:${cycleId}:${i}`) ?? [];
        allArticles.push(...batch);
    }

    console.log(`[Pipeline] Collected ${allArticles.length} articles from ${expected} fetcher groups.`);

    if (allArticles.length === 0) {
        return { status: 'empty', duration_ms: Date.now() - cycleStart };
    }

    // Stage 1: Batch pre-filter
    const relevant = await batchPrefilter(allArticles);
    console.log(`[Pipeline] ${relevant.length}/${allArticles.length} passed pre-filter.`);

    // Stages 0, 2-5: Process individually with concurrency
    await processConcurrently(relevant, 10);

    const duration = Date.now() - cycleStart;
    console.log(`[Pipeline] Cycle ${cycleId} complete in ${duration}ms. Processed ${relevant.length} articles.`);

    // Update stats
    await kvSet('stats:24h', {
        total_articles_processed: allArticles.length,
        prefilter_passed: relevant.length,
        last_cycle_duration_ms: duration,
        last_cycle_at: new Date().toISOString(),
        schema_version: '1.3',
    }, 3600);

    return { status: 'ok', total: allArticles.length, processed: relevant.length, duration_ms: duration };
});
