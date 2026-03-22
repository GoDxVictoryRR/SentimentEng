/**
 * Pipeline Orchestrator
 * Runs the full Stage 0→5 pipeline for a single article.
 * Called by the pipeline worker for each article in the batch.
 * Also provides a concurrent batch processor with configurable concurrency.
 */

import { InputArticle, DLQEntry, SCHEMA_VERSION } from '../types';
import { deduplicate } from './stage0-dedup';
import { batchPrefilter } from './stage1-prefilter';
import { runNER } from './stage2a-ner';
import { disambiguateEntities } from './stage2b-disambiguate';
import { runSentiment } from './stage3-sentiment';
import { updateSentimentLiquidity } from './stage4-aggregation';
import { persistSnapshot, updateStats } from './stage5-snapshot';
import { kvSet, kvGet, kvListPrefix } from '../cache/kv';
import { SessionExpiredError } from '../resilience/session';

const CONCURRENCY_LIMIT = 10;
const MIN_CONFIDENCE = 0.60;

/**
 * Process a single article through stages 0, 2a, 2b, 3, 4, 5.
 * Stage 1 (pre-filter) is run in batch before this function is called.
 */
async function processArticle(article: InputArticle): Promise<void> {
    const ts = new Date().toISOString();

    // ── STAGE 0: Deduplication ──
    const dedupResult = await deduplicate(article);
    if (dedupResult === 'EXACT_HIT') {
        await updateStats({ exact_dedup_hits: 1 });
        return;
    }
    if (dedupResult === 'SEMANTIC_HIT') {
        await updateStats({ semantic_dedup_hits: 1 });
        return;
    }

    // ── STAGE 2a: NER ──
    const nerResult = await runNER(article);
    if (nerResult.entities.length === 0) return;
    await updateStats({ ner_successful: 1 });

    // ── STAGE 2b: Disambiguation ──
    const validEntities = disambiguateEntities(
        nerResult.entities,
        article.body ?? article.summary ?? article.headline
    );
    if (validEntities.length === 0) return;

    // ── STAGE 3: Sentiment Scoring ──
    const sentimentResult = await runSentiment(article, validEntities);
    if (sentimentResult.scores.length === 0) return;
    await updateStats({ sentiment_scored: 1 });

    // ── STAGE 4: EWMA Aggregation (per ticker) ──
    for (const score of sentimentResult.scores) {
        if (score.confidence < MIN_CONFIDENCE) continue; // Skip low-confidence signals

        try {
            const updated = await updateSentimentLiquidity(
                score.ticker,
                score,
                article.source_weight,
                article.market_session,
                ts
            );

            // ── STAGE 5: Snapshot ──
            await persistSnapshot(updated);
        } catch (e) {
            console.error(`[Pipeline] Failed to aggregate ${score.ticker}:`, (e as Error).message);
        }
    }

    // Update the global watchlist with tickers we've seen
    await updateWatchlist(sentimentResult.scores.map(s => s.ticker));
}

/**
 * Updates the global watchlist with new tickers.
 */
async function updateWatchlist(tickers: string[]): Promise<void> {
    const existing = await kvGet<string[]>('watchlist:global') ?? [];
    const set = new Set([...existing, ...tickers]);
    await kvSet('watchlist:global', Array.from(set), 86400); // 24hr TTL
}

/**
 * Sends a failed article to the Dead Letter Queue for later inspection.
 */
async function sendToDLQ(article: InputArticle, stage: DLQEntry['failed_stage'], error: string): Promise<void> {
    const entry: DLQEntry = {
        article_id: article.article_id,
        headline: article.headline,
        failed_stage: stage,
        error_message: error,
        failed_at: new Date().toISOString(),
        retry_count: 0,
        schema_version: SCHEMA_VERSION,
    };
    await kvSet(`dlq:${article.article_id}`, entry, 604800); // 7 days
    await updateStats({ dlq_entries: 1 });
}

/**
 * Process articles concurrently with a configurable limit.
 * Used by the pipeline worker after collecting all fetcher outputs.
 */
export async function processConcurrently(
    articles: InputArticle[],
    concurrency: number = CONCURRENCY_LIMIT
): Promise<void> {
    const cycleStart = Date.now();

    // ── STAGE 1: Batch Pre-filter (runs on entire batch) ──
    const relevantArticles = await batchPrefilter(articles);
    await updateStats({
        total_articles_processed: articles.length,
        prefilter_passed: relevantArticles.length,
        prefilter_rejected: articles.length - relevantArticles.length,
    });

    // ── STAGES 0, 2-5: Process individually with concurrency limit ──
    const queue = [...relevantArticles];
    const active: Promise<void>[] = [];

    while (queue.length > 0 || active.length > 0) {
        while (active.length < concurrency && queue.length > 0) {
            const article = queue.shift()!;
            const p = processArticle(article)
                .catch(async (e) => {
                    if (e instanceof SessionExpiredError) {
                        // KV is unavailable — cannot write to DLQ
                        // Log to console with enough context to diagnose manually
                        console.error('[Pipeline] SESSION_EXPIRED — article dropped', {
                            article_id: article.article_id,
                            headline: article.headline,
                            timestamp: new Date().toISOString(),
                        });
                        // Do NOT rethrow — let remaining articles continue processing
                        return;
                    }
                    console.error(`[Pipeline] Article failed: ${article.headline}`, e);
                    await sendToDLQ(article, 'SENTIMENT', (e as Error).message);
                })
                .then(() => {
                    // Remove self from active pool
                    const idx = active.indexOf(p);
                    if (idx > -1) active.splice(idx, 1);
                });
            active.push(p);
        }

        if (active.length > 0) {
            await Promise.race(active);
        }
    }

    // Update cycle duration
    await updateStats({
        last_cycle_duration_ms: Date.now() - cycleStart,
        last_cycle_at: new Date().toISOString(),
    });

    console.log(`[Pipeline] Cycle complete. ${relevantArticles.length} articles processed in ${Date.now() - cycleStart}ms.`);
}

export { processArticle };
