'use client';

import useSWR from 'swr';
import { OverviewResponse, SentimentLiquidityIndex } from '../lib/types';

/**
 * Waits for the Puter SDK to become available, with a timeout.
 */
async function waitForPuter(timeoutMs = 8000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            if (typeof (window as any).puter !== 'undefined' && !!(window as any).puter?.kv) {
                return true;
            }
        } catch { /* ignore */ }
        await new Promise(r => setTimeout(r, 300));
    }
    return false;
}

/**
 * Fetches overview data from puter.kv (on Puter hosting) or returns mock data (local dev).
 */
async function fetchOverview(): Promise<OverviewResponse> {
    const puterReady = await waitForPuter();
    if (!puterReady) {
        // Local dev or SDK failed to load — return demo data so the UI is visible
        return getDemoOverview();
    }

    const puter = (window as any).puter;

    // KV helper inline (to avoid circular import issues in hooks)
    async function kvGet<T>(key: string): Promise<T | null> {
        try {
            const raw = await puter.kv.get(key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (entry.expiresAt && Date.now() > entry.expiresAt) return null;
            return entry.value;
        } catch { return null; }
    }

    const stats = await kvGet<any>('stats:24h');
    const watchlist = await kvGet<string[]>('watchlist:global') ?? [];

    const movers: SentimentLiquidityIndex[] = [];
    for (const ticker of watchlist.slice(0, 50)) {
        const sl = await kvGet<SentimentLiquidityIndex>(`sl:${ticker}`);
        if (sl) movers.push(sl);
    }

    const totalProcessed = stats?.total_articles_processed ?? 0;
    const exactHits = stats?.exact_dedup_hits ?? 0;
    const semanticHits = stats?.semantic_dedup_hits ?? 0;

    return {
        timestamp: new Date().toISOString(),
        market_regime: movers.length > 0
            ? (movers.filter(m => m.regime === 'RISK_ON').length > movers.length / 2
                ? 'RISK_ON'
                : movers.filter(m => m.regime === 'RISK_OFF').length > movers.length / 2
                    ? 'RISK_OFF'
                    : 'NEUTRAL')
            : 'NEUTRAL',
        total_articles_processed_24h: totalProcessed,
        cache_hit_rate: totalProcessed > 0 ? parseFloat(((exactHits / totalProcessed) * 100).toFixed(1)) : 0,
        semantic_dedup_rate: totalProcessed > 0 ? parseFloat(((semanticHits / totalProcessed) * 100).toFixed(1)) : 0,
        top_movers: movers,
    };
}

/**
 * Demo data for local development when Puter SDK is unavailable.
 */
function getDemoOverview(): OverviewResponse {
    const demoMovers: SentimentLiquidityIndex[] = [
        { ticker: 'NVDA', sentiment_liquidity_score: 0.4812, ewma: 0.4812, volatility: 0.1234, momentum: 0.0321, article_signal_strength: 0.85, n: 47, lastUpdated: new Date(Date.now() - 15000).toISOString(), regime: 'RISK_ON', market_session: 'MARKET_HOURS', schema_version: '1.3' },
        { ticker: 'AAPL', sentiment_liquidity_score: 0.2156, ewma: 0.2156, volatility: 0.0891, momentum: 0.0089, article_signal_strength: 0.72, n: 63, lastUpdated: new Date(Date.now() - 22000).toISOString(), regime: 'RISK_ON', market_session: 'MARKET_HOURS', schema_version: '1.3' },
        { ticker: 'TSLA', sentiment_liquidity_score: -0.3421, ewma: -0.3421, volatility: 0.2345, momentum: -0.0567, article_signal_strength: 0.91, n: 38, lastUpdated: new Date(Date.now() - 8000).toISOString(), regime: 'RISK_OFF', market_session: 'MARKET_HOURS', schema_version: '1.3' },
        { ticker: 'MSFT', sentiment_liquidity_score: 0.1789, ewma: 0.1789, volatility: 0.0567, momentum: 0.0034, article_signal_strength: 0.68, n: 55, lastUpdated: new Date(Date.now() - 40000).toISOString(), regime: 'RISK_ON', market_session: 'MARKET_HOURS', schema_version: '1.3' },
        { ticker: 'META', sentiment_liquidity_score: 0.0923, ewma: 0.0923, volatility: 0.1578, momentum: -0.0123, article_signal_strength: 0.64, n: 29, lastUpdated: new Date(Date.now() - 30000).toISOString(), regime: 'NEUTRAL', market_session: 'MARKET_HOURS', schema_version: '1.3' },
        { ticker: 'GOOGL', sentiment_liquidity_score: 0.1345, ewma: 0.1345, volatility: 0.0789, momentum: 0.0045, article_signal_strength: 0.71, n: 41, lastUpdated: new Date(Date.now() - 18000).toISOString(), regime: 'NEUTRAL', market_session: 'MARKET_HOURS', schema_version: '1.3' },
        { ticker: 'AMZN', sentiment_liquidity_score: -0.0567, ewma: -0.0567, volatility: 0.1123, momentum: -0.0234, article_signal_strength: 0.59, n: 33, lastUpdated: new Date(Date.now() - 25000).toISOString(), regime: 'NEUTRAL', market_session: 'MARKET_HOURS', schema_version: '1.3' },
        { ticker: 'BTC-USD', sentiment_liquidity_score: 0.5678, ewma: 0.5678, volatility: 0.3456, momentum: 0.0789, article_signal_strength: 0.93, n: 72, lastUpdated: new Date(Date.now() - 5000).toISOString(), regime: 'RISK_ON', market_session: 'MARKET_HOURS', schema_version: '1.3' },
        { ticker: 'SPY', sentiment_liquidity_score: 0.0234, ewma: 0.0234, volatility: 0.0456, momentum: 0.0012, article_signal_strength: 0.45, n: 89, lastUpdated: new Date(Date.now() - 12000).toISOString(), regime: 'NEUTRAL', market_session: 'MARKET_HOURS', schema_version: '1.3' },
    ];

    return {
        timestamp: new Date().toISOString(),
        market_regime: 'RISK_ON',
        total_articles_processed_24h: 2847,
        cache_hit_rate: 67.3,
        semantic_dedup_rate: 18.9,
        top_movers: demoMovers,
    };
}

export function useSentimentOverview() {
    const { data, error, isLoading, isValidating, mutate } = useSWR<OverviewResponse>(
        'sentiment-overview',
        fetchOverview,
        {
            refreshInterval: 30_000,
            revalidateOnFocus: true,
            revalidateOnReconnect: true,
            keepPreviousData: true,
            dedupingInterval: 10_000,
        }
    );

    return {
        data,
        isLoading,
        isRefreshing: isValidating && !isLoading,
        error,
        mutate,
    };
}
