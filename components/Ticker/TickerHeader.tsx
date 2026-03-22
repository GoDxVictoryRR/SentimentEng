'use client';

import React from 'react';
import { SentimentGauge } from '../Dashboard/SentimentGauge';
import { MarketRegimeBadge } from '../Dashboard/MarketRegimeBadge';
import { VolatilityBar } from '../Charts/VolatilityBar';
import { MomentumIndicator } from '../Charts/MomentumIndicator';

interface Props {
    ticker: string;
    score: number;
    isProjected: boolean;
    lastUpdated: string;
    isRefreshing: boolean;
    regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
    volatility: number;
    momentum: number;
    signalCount: number;
    signalStrength: number;
}

export function TickerHeader({
    ticker,
    score,
    isProjected,
    lastUpdated,
    isRefreshing,
    regime,
    volatility,
    momentum,
    signalCount,
    signalStrength,
}: Props) {
    return (
        <div className="ticker-header">
            <div className="ticker-title-row">
                <h1 className="ticker-symbol">{ticker}</h1>
                <MarketRegimeBadge regime={regime} />
                <div className="ticker-meta">
                    <span className={`refresh-dot ${isRefreshing ? 'active' : ''}`} />
                    <span className="ticker-last-updated">
                        {lastUpdated}
                        {isProjected && <span className="projected-tag">(projected)</span>}
                    </span>
                </div>
            </div>

            <div className="ticker-stats-grid">
                <div className="ticker-gauge-wrapper">
                    <SentimentGauge score={score} size={160} label="SL Index" />
                </div>

                <div className="ticker-metrics-col">
                    <VolatilityBar volatility={volatility} />
                    <MomentumIndicator momentum={momentum} />

                    <div className="ticker-signal-info">
                        <div className="signal-stat">
                            <span className="signal-stat-label">Signals</span>
                            <span className="signal-stat-value">{signalCount}</span>
                        </div>
                        <div className="signal-stat">
                            <span className="signal-stat-label">Strength</span>
                            <span className="signal-stat-value">{(signalStrength ?? 0).toFixed(4)}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
