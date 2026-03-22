'use client';

import { useTickerData } from '../../../hooks/useTickerData';
import { useLastUpdated } from '../../../hooks/useLastUpdated';
import { TickerHeader } from '../../../components/Ticker/TickerHeader';
import { SentimentTimeline } from '../../../components/Charts/SentimentTimeline';
import { RecentSignals } from '../../../components/Ticker/RecentSignals';
import Link from 'next/link';

export default function TickerClientPage({ symbol }: { symbol: string }) {
    const { data, shadowScore, isLoading, isRefreshing } = useTickerData(symbol);
    const lastUpdated = useLastUpdated(data?.current?.lastUpdated);

    const displayScore = shadowScore ?? data?.current?.sentiment_liquidity_score ?? 0;

    if (isLoading) {
        return (
            <main className="ticker-page">
                <div className="ticker-loading">
                    <div className="loading-pulse" />
                    <p>Loading {symbol} data...</p>
                </div>
            </main>
        );
    }

    return (
        <main className="ticker-page">
            <div className="ticker-breadcrumb">
                <Link href="/" className="breadcrumb-link">← Dashboard</Link>
                <span className="breadcrumb-sep">/</span>
                <span className="breadcrumb-current">{symbol}</span>
            </div>

            <TickerHeader
                ticker={symbol}
                score={displayScore}
                isProjected={!!shadowScore}
                lastUpdated={lastUpdated}
                isRefreshing={isRefreshing}
                regime={data?.current?.regime ?? 'NEUTRAL'}
                volatility={data?.current?.volatility ?? 0}
                momentum={data?.current?.momentum ?? 0}
                signalCount={data?.current?.n ?? 0}
                signalStrength={data?.current?.article_signal_strength ?? 0}
            />

            <SentimentTimeline history={data?.history_24h ?? []} events={data?.timeline_events ?? []} />

            <RecentSignals signals={data?.recent_signals ?? []} />
        </main>
    );
}
