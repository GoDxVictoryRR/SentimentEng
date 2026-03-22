'use client';

import React, { useState, useMemo } from 'react';
import { SentimentLiquidityIndex } from '../../lib/types';
import Link from 'next/link';

interface Props {
    movers: SentimentLiquidityIndex[];
}

type SortMode = 'momentum' | 'volume';

export function TopMovers({ movers }: Props) {
    const [sortMode, setSortMode] = useState<SortMode>('momentum');

    const sorted = useMemo(() => {
        const copy = [...movers];
        if (sortMode === 'momentum') {
            return copy.sort((a, b) => Math.abs(b.momentum) - Math.abs(a.momentum));
        } else {
            // Note: Currently we don't have article_count_24h on the SentimentLiquidityIndex in this context.
            // We use 'n' as a proxy for volume since that's what was tracked.
            return copy.sort((a, b) => b.n - a.n);
        }
    }, [movers, sortMode]);

    if (movers.length === 0) {
        return (
            <div className="top-movers-panel">
                <h2>Top Movers</h2>
                <div className="empty-state">
                    <p>Waiting for data... Pipeline is processing feeds.</p>
                    <div className="loading-pulse" />
                </div>
            </div>
        );
    }

    return (
        <div className="top-movers-panel">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold text-sm uppercase tracking-wide">Top Movers</h2>
                <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
                    {(['momentum', 'volume'] as SortMode[]).map(mode => (
                        <button
                            key={mode}
                            onClick={() => setSortMode(mode)}
                            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${sortMode === mode
                                ? 'bg-gray-600 text-white shadow'
                                : 'text-gray-400 hover:text-gray-300'
                                }`}
                        >
                            {mode === 'momentum' ? '⚡ Top Movers' : '📊 Most Active'}
                        </button>
                    ))}
                </div>
            </div>
            <div className="movers-grid">
                {sorted.slice(0, 12).map((sl) => (
                    <Link
                        key={sl.ticker}
                        href={`/ticker/view/?s=${sl.ticker}`}
                        className="mover-card"
                    >
                        <div className="mover-header">
                            <span className="mover-ticker">{sl.ticker}</span>
                            <span className={`mover-regime badge-${sl.regime.toLowerCase()}`}>
                                {sl.regime === 'RISK_ON' ? '🟢' : sl.regime === 'RISK_OFF' ? '🔴' : '⚪'}
                            </span>
                        </div>

                        <div className="mover-score">
                            <span
                                className={`score-value ${sl.sentiment_liquidity_score > 0 ? 'bullish' : sl.sentiment_liquidity_score < 0 ? 'bearish' : 'neutral'}`}
                            >
                                {sl.sentiment_liquidity_score > 0 ? '+' : ''}{(sl.sentiment_liquidity_score ?? 0).toFixed(4)}
                            </span>
                        </div>

                        <div className="mover-details">
                            <div className="detail-row">
                                <span className="detail-label">Vol</span>
                                <span className="detail-value">{(sl.volatility ?? 0).toFixed(4)}</span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Mom</span>
                                <span className={`detail-value ${sl.momentum > 0 ? 'bullish' : sl.momentum < 0 ? 'bearish' : ''}`}>
                                    {sl.momentum > 0 ? '▲' : sl.momentum < 0 ? '▼' : '–'} {(Math.abs(sl.momentum ?? 0)).toFixed(4)}
                                </span>
                            </div>
                            <div className="detail-row">
                                <span className="detail-label">Signals</span>
                                <span className="detail-value">{sl.n}</span>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}
