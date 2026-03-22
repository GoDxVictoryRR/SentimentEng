/**
 * STAGE 4 — EWMA Aggregation with Distributed Locking
 * Updates the Sentiment Liquidity Index for each ticker using
 * exponentially weighted moving averages, protected by atomic locks.
 */

import { SentimentScore, SentimentLiquidityIndex, SCHEMA_VERSION } from '../types';
import { kvGet, kvSet } from '../cache/kv';
import { withLock } from '../resilience/lock';

const LAMBDA = 0.94; // EWMA decay factor

export async function updateSentimentLiquidity(
    ticker: string,
    score: SentimentScore,
    sourceWeight: number,
    marketSession: string,
    timestamp: string
): Promise<SentimentLiquidityIndex> {

    // ATOMIC LOCK via puter.kv.incr() — prevents EWMA race condition.
    // incr() is server-side atomic: no two workers can both get count=1.
    return await withLock(ticker, async () => {

        const cached = await kvGet<SentimentLiquidityIndex>(`sl:${ticker}`);
        const prev: SentimentLiquidityIndex = cached ?? {
            ticker,
            ewma: 0,
            sentiment_liquidity_score: 0,
            volatility: 0,
            momentum: 0,
            article_signal_strength: 0,
            n: 0,
            lastUpdated: timestamp,
            regime: 'NEUTRAL' as const,
            market_session: marketSession,
            schema_version: SCHEMA_VERSION,
        };

        const weightedScore = score.sentiment_score * score.confidence * sourceWeight;
        const ewma = LAMBDA * prev.ewma + (1 - LAMBDA) * weightedScore;

        // Correct variance: uses newly computed ewma (not prev.ewma)
        const prevVariance = prev.volatility ** 2;
        const variance = LAMBDA * prevVariance + (1 - LAMBDA) * Math.pow(weightedScore - ewma, 2);

        const updated: SentimentLiquidityIndex = {
            ticker,
            sentiment_liquidity_score: parseFloat(ewma.toFixed(4)),
            ewma: parseFloat(ewma.toFixed(4)),
            volatility: parseFloat(Math.sqrt(Math.max(0, variance)).toFixed(4)),
            momentum: prev.n === 0 ? 0 : parseFloat((ewma - prev.ewma).toFixed(4)),
            article_signal_strength: parseFloat((score.confidence * Math.abs(score.sentiment_score) * sourceWeight).toFixed(4)),
            n: prev.n + 1,
            lastUpdated: timestamp,
            regime: ewma > 0.15 ? 'RISK_ON' : ewma < -0.15 ? 'RISK_OFF' : 'NEUTRAL',
            market_session: marketSession,
            schema_version: SCHEMA_VERSION,
        };

        await kvSet(`sl:${ticker}`, updated); // no TTL — rolling
        return updated;

    }); // lock auto-released here (or on error via finally block in withLock)
}
