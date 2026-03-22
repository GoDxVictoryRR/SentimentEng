/**
 * STAGE 5 — Hourly Snapshot + Pipeline Metrics
 * Persists hourly SL index snapshots to KV for historical charting.
 * Updates global pipeline stats (articles processed, cache rates, etc).
 */

import { SentimentLiquidityIndex, SCHEMA_VERSION } from '../types';
import { kvGet, kvSet, kvListPrefix } from '../cache/kv';

/**
 * Generates an hourly snapshot key.
 * Format: sl:history:{ticker}:YYYYMMDD_HH
 */
function snapshotKey(ticker: string, date?: Date): string {
    const d = date ?? new Date();
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const hour = String(d.getUTCHours()).padStart(2, '0');
    return `sl:history:${ticker}:${year}${month}${day}_${hour}`;
}

/**
 * Persists a snapshot of the current SL index for the given ticker.
 * Only writes if a snapshot doesn't already exist for this hour (idempotent).
 */
export async function persistSnapshot(sl: SentimentLiquidityIndex): Promise<void> {
    const key = snapshotKey(sl.ticker);
    const existing = await kvGet<SentimentLiquidityIndex>(key);

    if (!existing) {
        // First snapshot this hour — write it
        await kvSet(key, sl, 259200); // 72hr TTL
    } else {
        // Update the snapshot with the latest values if more recent
        if (new Date(sl.lastUpdated) > new Date(existing.lastUpdated)) {
            await kvSet(key, sl, 259200);
        }
    }
}

/**
 * Retrieves the last 24 hours of snapshots for a given ticker.
 */
export async function getHistory24h(ticker: string): Promise<SentimentLiquidityIndex[]> {
    const keys = await kvListPrefix(`sl:history:${ticker}:`);
    const snapshots: SentimentLiquidityIndex[] = [];

    // Get the last 24 keys (24 hours of data)
    const recentKeys = keys.slice(-24);
    for (const key of recentKeys) {
        const snapshot = await kvGet<SentimentLiquidityIndex>(key);
        if (snapshot) snapshots.push(snapshot);
    }

    return snapshots;
}

// ── Pipeline Stats ──

interface PipelineStats {
    total_articles_processed: number;
    exact_dedup_hits: number;
    semantic_dedup_hits: number;
    prefilter_passed: number;
    prefilter_rejected: number;
    ner_successful: number;
    sentiment_scored: number;
    dlq_entries: number;
    last_cycle_duration_ms: number;
    last_cycle_at: string;
    schema_version: typeof SCHEMA_VERSION;
}

/**
 * Updates the global 24h pipeline stats.
 */
export async function updateStats(partial: Partial<PipelineStats>): Promise<PipelineStats> {
    const stats = await kvGet<PipelineStats>('stats:24h') ?? {
        total_articles_processed: 0,
        exact_dedup_hits: 0,
        semantic_dedup_hits: 0,
        prefilter_passed: 0,
        prefilter_rejected: 0,
        ner_successful: 0,
        sentiment_scored: 0,
        dlq_entries: 0,
        last_cycle_duration_ms: 0,
        last_cycle_at: new Date().toISOString(),
        schema_version: SCHEMA_VERSION,
    };

    const updated: PipelineStats = {
        ...stats,
        total_articles_processed: stats.total_articles_processed + (partial.total_articles_processed ?? 0),
        exact_dedup_hits: stats.exact_dedup_hits + (partial.exact_dedup_hits ?? 0),
        semantic_dedup_hits: stats.semantic_dedup_hits + (partial.semantic_dedup_hits ?? 0),
        prefilter_passed: stats.prefilter_passed + (partial.prefilter_passed ?? 0),
        prefilter_rejected: stats.prefilter_rejected + (partial.prefilter_rejected ?? 0),
        ner_successful: stats.ner_successful + (partial.ner_successful ?? 0),
        sentiment_scored: stats.sentiment_scored + (partial.sentiment_scored ?? 0),
        dlq_entries: stats.dlq_entries + (partial.dlq_entries ?? 0),
        last_cycle_duration_ms: partial.last_cycle_duration_ms ?? stats.last_cycle_duration_ms,
        last_cycle_at: partial.last_cycle_at ?? stats.last_cycle_at,
        schema_version: SCHEMA_VERSION,
    };

    await kvSet('stats:24h', updated, 3600); // 1hr TTL — regenerated each cycle
    return updated;
}
