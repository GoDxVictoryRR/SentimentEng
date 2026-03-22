'use client';

import useSWR from 'swr';
import { SentimentLiquidityIndex, SentimentScore, TickerResponse } from '../lib/types';

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

async function fetchTickerData(symbol: string): Promise<TickerResponse> {
    const puterReady = await waitForPuter();
    if (!puterReady) {
        return getDemoTickerData(symbol);
    }

    const puter = (window as any).puter;

    async function kvGet<T>(key: string): Promise<T | null> {
        try {
            const raw = await puter.kv.get(key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (entry.expiresAt && Date.now() > entry.expiresAt) return null;
            return entry.value;
        } catch { return null; }
    }

    async function kvListPrefix(prefix: string): Promise<string[]> {
        try { return await puter.kv.list(prefix); } catch { return []; }
    }

    const current = await kvGet<SentimentLiquidityIndex>(`sl:${symbol}`);
    const historyKeys = await kvListPrefix(`sl:history:${symbol}:`);
    const history: SentimentLiquidityIndex[] = [];
    for (const key of historyKeys.slice(-24)) {
        const snap = await kvGet<SentimentLiquidityIndex>(key);
        if (snap) history.push(snap);
    }

    // Fetch macro timeline
    const macroTimelineRaw = await kvGet<any[]>('macro:timeline');
    const macroTimeline = macroTimelineRaw || [];

    // Assuming we also have recent signals stored somewhere, for now we will just use macro items
    // If the pipeline was storing ticker-specific events we could fetch them here

    return {
        current: current ?? { ticker: symbol, sentiment_liquidity_score: 0, ewma: 0, volatility: 0, momentum: 0, article_signal_strength: 0, n: 0, lastUpdated: new Date().toISOString(), regime: 'NEUTRAL', market_session: 'AFTER_HOURS', schema_version: '1.3' },
        history_24h: history,
        recent_signals: [],
        timeline_events: macroTimeline
    };
}

function getDemoTickerData(symbol: string): TickerResponse {
    const now = Date.now();
    const history: SentimentLiquidityIndex[] = Array.from({ length: 24 }, (_, i) => ({
        ticker: symbol,
        sentiment_liquidity_score: parseFloat((Math.sin(i / 4) * 0.3 + Math.random() * 0.1 - 0.05).toFixed(4)),
        ewma: parseFloat((Math.sin(i / 4) * 0.3).toFixed(4)),
        volatility: parseFloat((0.08 + Math.random() * 0.05).toFixed(4)),
        momentum: parseFloat(((Math.sin((i + 1) / 4) - Math.sin(i / 4)) * 0.3).toFixed(4)),
        article_signal_strength: parseFloat((0.5 + Math.random() * 0.4).toFixed(4)),
        n: Math.floor(20 + Math.random() * 40),
        lastUpdated: new Date(now - (24 - i) * 3600000).toISOString(),
        regime: Math.sin(i / 4) > 0.15 ? 'RISK_ON' : Math.sin(i / 4) < -0.15 ? 'RISK_OFF' : 'NEUTRAL',
        market_session: 'MARKET_HOURS',
        schema_version: '1.3',
    }));

    const signals: SentimentScore[] = [
        { ticker: symbol, sentiment_score: 0.65, confidence: 0.88, signal_type: 'EARNINGS', time_horizon: 'SHORT_TERM', reasoning_tag: 'Strong Q4 earnings beat' },
        { ticker: symbol, sentiment_score: 0.35, confidence: 0.72, signal_type: 'ANALYST', time_horizon: 'MEDIUM_TERM', reasoning_tag: 'Price target raised by GS' },
        { ticker: symbol, sentiment_score: -0.20, confidence: 0.61, signal_type: 'REGULATORY', time_horizon: 'LONG_TERM', reasoning_tag: 'EU antitrust investigation' },
        { ticker: symbol, sentiment_score: 0.80, confidence: 0.94, signal_type: 'PRODUCT', time_horizon: 'INTRADAY', reasoning_tag: 'Major product launch event' },
        { ticker: symbol, sentiment_score: -0.45, confidence: 0.78, signal_type: 'MACRO', time_horizon: 'SHORT_TERM', reasoning_tag: 'Fed signals rate hike pause' },
    ];

    return {
        current: history[history.length - 1],
        history_24h: history,
        recent_signals: signals,
        timeline_events: [
            { type: 'macro', ticker: symbol, event: 'Fed signals rate hike pause', impact: 'positive', ai_impact_summary: 'Boosts liquidity expectations for tech sector', time_ago: '2h ago' },
            { type: 'stock', ticker: symbol, event: 'Major product launch event', impact: 'positive', ai_impact_summary: 'Drives short-term retail momentum', time_ago: '4h ago' }
        ]
    };
}

function projectScoreForward(sl: SentimentLiquidityIndex): number {
    const secondsSinceUpdate = (Date.now() - new Date(sl.lastUpdated).getTime()) / 1000;
    // Decay factor drops from 1.0 (at t=0) towards 0 as time passes
    const decayFactor = Math.exp(-secondsSinceUpdate / 300);
    // As time passes, (1 - decayFactor) grows from 0 to 1, drifting the score in the direction of momentum
    const projected = sl.sentiment_liquidity_score + (sl.momentum * (1 - decayFactor));
    return Math.max(-1.0, Math.min(1.0, parseFloat(projected.toFixed(4))));
}

export function useTickerData(symbol: string) {
    const { data, error, isLoading, isValidating } = useSWR<TickerResponse>(
        symbol ? `ticker-${symbol}` : null,
        () => fetchTickerData(symbol),
        {
            refreshInterval: 30_000,
            keepPreviousData: true,
            revalidateOnFocus: true,
        }
    );

    const shadowScore = data?.current ? projectScoreForward(data.current) : null;

    return {
        data,
        shadowScore,
        isLoading,
        isRefreshing: isValidating && !isLoading,
        error,
    };
}
