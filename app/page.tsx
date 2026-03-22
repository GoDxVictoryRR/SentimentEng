'use client';

import { useEffect, useState } from 'react';
import { useSentimentOverview } from '../hooks/useSentimentOverview';
import { useLastUpdated } from '../hooks/useLastUpdated';
import { SentimentOverview } from '../components/Dashboard/SentimentOverview';
import { TopMovers } from '../components/Dashboard/TopMovers';
import { MacroRiskBriefs } from '../components/Dashboard/MacroRiskBriefs';
import { GlobalExposureMap } from '../components/Dashboard/GlobalExposureMap';

import MarketHeatmap from '../components/Charts/MarketHeatmap';

/**
 * Dashboard skeleton shown while data is loading.
 */
function DashboardSkeleton() {
    return (
        <main className="dashboard">
            <div className="overview-panel skeleton">
                <div className="skeleton-header" />
                <div className="overview-metrics">
                    {[1, 2, 3, 4].map(i => (
                        <div key={i} className="metric-card skeleton-card">
                            <div className="skeleton-line short" />
                            <div className="skeleton-line long" />
                        </div>
                    ))}
                </div>
            </div>
            <div className="top-movers-panel skeleton">
                <div className="skeleton-header" />
                <div className="movers-grid">
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <div key={i} className="mover-card skeleton-card">
                            <div className="skeleton-line short" />
                            <div className="skeleton-line long" />
                            <div className="skeleton-line medium" />
                        </div>
                    ))}
                </div>
            </div>
            <div className="heatmap-panel skeleton">
                <div className="skeleton-header" />
                <div className="skeleton-card" style={{ height: '320px' }} />
            </div>
        </main>
    );
}

/** Helper to store data in KV with the wrapper format the hooks expect */
async function kvSet(p: any, key: string, value: any, ttlSec = 3600) {
    await p.kv.set(key, JSON.stringify({
        value,
        expiresAt: Date.now() + ttlSec * 1000,
    }));
}

/**
 * Client-side AI pipeline: generates financial sentiment data using puter.ai.chat()
 * and stores results in puter.kv for the dashboard hooks to read.
 */
async function runClientPipeline(p: any) {
    console.log('[Pipeline] Starting client-side AI sentiment pipeline...');

    // Check if we already ran recently (avoid re-running on every page load)
    try {
        const lastRun = await p.kv.get('pipeline:last_client_run');
        if (lastRun) {
            const parsed = JSON.parse(lastRun);
            if (parsed.value && Date.now() - parsed.value < 300_000) {
                console.log('[Pipeline] Skipping — last run < 5 min ago');
                return;
            }
        }
    } catch { /* proceed */ }

    await kvSet(p, 'pipeline:last_client_run', Date.now(), 600);

    try {
        // Stage 1: Ask AI for current financial sentiment analysis
        const prompt = `You are a quantitative financial analyst. Generate a realistic snapshot of current market sentiment for these 8 major tickers: AAPL, GOOGL, MSFT, TSLA, NVDA, AMZN, META, JPM.

For each ticker, provide:
- sentiment_score: a number from -1 to 1 (negative = bearish, positive = bullish)
- confidence: a number from 0.5 to 1.0
- signal_type: one of EARNINGS, ANALYST, REGULATORY, PRODUCT, MACRO, MANAGEMENT
- time_horizon: one of INTRADAY, SHORT_TERM, MEDIUM_TERM, LONG_TERM
- reasoning_tag: a 3-8 word summary of why
- article_count_24h: realistic number 3-25

Also provide:
- market_regime: RISK_ON, RISK_OFF, or NEUTRAL
- total_articles_processed: a realistic number 30-120
- macro_risk_briefs: 6-8 objects with { severity: "High" | "Med" | "Low", ticker_impact: string (e.g. "NVDA ↑"), brief: string, source: string }
- global_instability_index: a number 0-100 indicating global macroeconomic risk
- rising_risks: Top 5 risks as { title: string, points: string (e.g. "+17"), driver: string }
- timeline_events: Mixed stock and macro events (6-10 total) with { type: "macro" | "stock", ticker: string, event: string, impact: "positive" | "negative", ai_impact_summary: string, time_ago: string }
- global_exposure: An object showing country risk and impacted tickers, e.g. { "Taiwan": { score: 85, affected_tickers: ["NVDA", "AAPL"] }, "Israel": { score: 90, affected_tickers: ["META", "GOOGL"] } }

Return ONLY valid JSON:
{
  "market_regime": "string",
  "total_articles_processed": number,
  "macro_risk_briefs": [{"severity": "string", "ticker_impact": "string", "brief": "string", "source": "string"}],
  "global_instability_index": number,
  "rising_risks": [{"title": "string", "points": "string", "driver": "string"}],
  "timeline_events": [{"type": "string", "ticker": "string", "event": "string", "impact": "string", "ai_impact_summary": "string", "time_ago": "string"}],
  "global_exposure": {"CountryName": {"score": number, "affected_tickers": ["string"]}},
  "tickers": [
    {
      "ticker": "string",
      "sentiment_score": number,
      "confidence": number,
      "signal_type": "string",
      "time_horizon": "string",
      "reasoning_tag": "string",
      "article_count_24h": number
    }
  ]
}`;

        console.log('[Pipeline] Querying AI for market sentiment...');
        const raw = await p.ai.chat(prompt, { model: 'gpt-4o-mini' });
        const text = typeof raw === 'string' ? raw : raw?.message?.content ?? JSON.stringify(raw);

        // Parse JSON (handle markdown wrapping)
        let data;
        try {
            data = JSON.parse(text);
        } catch {
            const cleaned = text.replace(/\`\`\`json\n?/g, '').replace(/\`\`\`\n?/g, '').trim();
            const start = cleaned.indexOf('{');
            const end = cleaned.lastIndexOf('}');
            if (start >= 0 && end > start) {
                data = JSON.parse(cleaned.slice(start, end + 1));
            } else {
                throw new Error('Could not parse AI response');
            }
        }

        console.log('[Pipeline] Got sentiment for', data.tickers?.length, 'tickers');

        // Stage 2: Store ticker data in KV
        const tickers = data.tickers ?? [];
        const tickerNames: string[] = [];
        const globalRegime = data.market_regime ?? 'NEUTRAL';

        // Store new Macro data
        await kvSet(p, 'macro:briefs', data.macro_risk_briefs ?? [], 3600);
        await kvSet(p, 'macro:index', data.global_instability_index ?? 50, 3600);
        await kvSet(p, 'macro:rising_risks', data.rising_risks ?? [], 3600);
        await kvSet(p, 'macro:timeline', data.timeline_events ?? [], 3600);
        await kvSet(p, 'macro:exposure', data.global_exposure ?? {}, 3600);

        for (const t of tickers) {
            tickerNames.push(t.ticker);

            // Generate realistic filler data for the UI
            const score = parseFloat(t.sentiment_score) || 0;
            const volatility = Math.random() * 0.05 + 0.01;
            const momentum = score * (Math.random() * 0.5 + 0.5);

            await kvSet(p, `sl:${t.ticker}`, {
                ticker: t.ticker,
                sentiment_liquidity_score: score, // REQUIRED BY UI
                composite_score: score,
                confidence: parseFloat(t.confidence) || 0.8,
                volatility: volatility,          // REQUIRED BY UI
                momentum: momentum,              // REQUIRED BY UI
                regime: globalRegime,            // REQUIRED BY UI
                ewma: score,
                signal_type: t.signal_type,
                time_horizon: t.time_horizon,
                reasoning_tag: t.reasoning_tag,
                article_count_24h: t.article_count_24h,
                n: t.article_count_24h || 5,
                last_updated: new Date().toISOString(),
            }, 3600);
        }

        // Stage 3: Store watchlist and stats
        await kvSet(p, 'watchlist:global', tickerNames, 3600);
        await kvSet(p, 'stats:24h', {
            total_articles_processed: data.total_articles_processed ?? tickers.reduce((s: number, t: any) => s + (t.article_count_24h ?? 0), 0),
            exact_dedup_hits: Math.floor(Math.random() * 10) + 3,
            semantic_dedup_hits: Math.floor(Math.random() * 8) + 2,
            regime: globalRegime,
        }, 3600);

        console.log('[Pipeline] ✅ Dashboard data seeded! Refresh to see results.');
    } catch (err) {
        console.error('[Pipeline] AI pipeline error:', err);
    }
}

export default function Dashboard() {
    const { data, isLoading, isRefreshing, mutate } = useSentimentOverview();
    const lastUpdated = useLastUpdated(data?.timestamp);
    const [isGenerating, setIsGenerating] = useState(false);
    const [pipelineError, setPipelineError] = useState<string | null>(null);
    const [showMap, setShowMap] = useState(false);

    // Run client-side AI pipeline on mount
    useEffect(() => {
        const run = async () => {
            let p = (window as any).puter;
            let attempts = 0;
            while ((!p || !p.ai || !p.kv) && attempts < 20) {
                await new Promise(r => setTimeout(r, 500));
                p = (window as any).puter;
                attempts++;
            }
            if (!p?.ai || !p?.kv) {
                console.warn('[Pipeline] Puter SDK not available');
                setPipelineError('Puter SDK not loaded.');
                return;
            }

            try {
                // Check if we need to run
                const lastRunRaw = await p.kv.get('pipeline:last_client_run');
                const lastRun = lastRunRaw ? JSON.parse(lastRunRaw)?.value : 0;

                // If it's a completely new user (never run), show the generating state immediately
                if (!lastRun || Date.now() - lastRun > 300_000) {
                    setIsGenerating(true);
                }

                await runClientPipeline(p);
                // Refresh dashboard data after pipeline runs
                setTimeout(() => mutate?.(), 1000);
            } catch (err: any) {
                setPipelineError(err.message || 'Pipeline failed');
            } finally {
                setIsGenerating(false);
            }
        };
        run();
    }, []);

    // Show skeleton if SWR is still loading, OR if we are explicitly running the pipeline for a new user
    // (A "new user" is detected when they have 0 processed articles AND the pipeline is generating)
    const showingSkeleton = isLoading || (isGenerating && (!data?.total_articles_processed_24h || data.total_articles_processed_24h === 0));

    if (showingSkeleton) {
        return (
            <div className="relative">
                {isGenerating && (
                    <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-accent-blue/20 border border-accent-blue backdrop-blur-md text-accent-blue px-6 py-3 rounded-full flex items-center gap-3 shadow-[0_0_30px_rgba(40,112,253,0.3)] animate-fade-in">
                        <div className="w-4 h-4 rounded-full border-2 border-accent-blue border-r-transparent animate-spin" />
                        <span className="font-semibold tracking-wide text-sm whitespace-nowrap">
                            INITIALIZING AI MODELS: GENERATING NEW USER SENTIMENT DATA... (~10s)
                        </span>
                    </div>
                )}
                <DashboardSkeleton />
            </div>
        );
    }

    return (
        <main className="dashboard">
            {pipelineError && (
                <div className="bg-accent-red/20 border border-accent-red text-accent-red px-4 py-2 rounded-lg mb-4 text-sm font-medium">
                    Pipeline Error: {pipelineError}
                </div>
            )}
            <SentimentOverview
                regime={data?.market_regime}
                articleCount={data?.total_articles_processed_24h}
                cacheHitRate={data?.cache_hit_rate}
                semanticDedupRate={data?.semantic_dedup_rate}
                lastUpdated={lastUpdated}
                isRefreshing={isRefreshing}
            />

            <div className="flex justify-end mb-2">
                <button
                    onClick={() => setShowMap(!showMap)}
                    className="px-4 py-2 bg-[#151a23] hover:bg-accent-blue/10 border border-accent-blue text-accent-blue rounded-lg font-bold text-sm transition-colors shadow-[0_0_15px_rgba(40,112,253,0.1)] flex items-center gap-2"
                >
                    {showMap ? '✕ CLOSE MAP' : '🌍 GLOBAL EXPOSURE'}
                </button>
            </div>

            {showMap && (
                <div className="mb-6 animate-fade-in">
                    <GlobalExposureMap />
                </div>
            )}

            <div className="flex flex-col lg:flex-row gap-6">
                <div className="flex-1">
                    <TopMovers movers={data?.top_movers ?? []} />
                </div>
                <div className="w-full lg:w-[360px]">
                    <MacroRiskBriefs />
                </div>
            </div>
            <MarketHeatmap data={(data?.top_movers ?? []).map(m => ({ ...m, article_count_24h: m.n }))} />
        </main>
    );
}
