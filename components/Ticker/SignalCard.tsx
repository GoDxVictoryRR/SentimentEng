'use client';

import React from 'react';
import { SentimentScore } from '../../lib/types';

interface Props {
    signal: SentimentScore;
}

export function SignalCard({ signal }: Props) {
    const scoreColor = signal.sentiment_score > 0
        ? 'var(--color-bullish)'
        : signal.sentiment_score < 0
            ? 'var(--color-bearish)'
            : 'var(--color-neutral)';

    const signalTypeIcons: Record<string, string> = {
        EARNINGS: '📊', ANALYST: '📋', REGULATORY: '⚖️', MA: '🤝',
        MACRO: '🌐', GEOPOLITICAL: '🗺️', SUPPLY_CHAIN: '🔗', MANAGEMENT: '👔',
        PRODUCT: '🚀', LEGAL: '⚖️', OTHER: '📄',
    };

    return (
        <div className="signal-card">
            <div className="signal-card-header">
                <span className="signal-type-icon">
                    {signalTypeIcons[signal.signal_type] ?? '📄'}
                </span>
                <span className="signal-type-label">{signal.signal_type}</span>
                <span className="signal-horizon">{signal.time_horizon}</span>
            </div>

            <div className="signal-card-body">
                <span className="signal-score" style={{ color: scoreColor }}>
                    {signal.sentiment_score > 0 ? '+' : ''}{(signal.sentiment_score ?? 0).toFixed(2)}
                </span>
                <div className="signal-confidence-bar">
                    <div
                        className="signal-confidence-fill"
                        style={{ width: `${signal.confidence * 100}%` }}
                    />
                    <span className="signal-confidence-label">{((signal.confidence ?? 0) * 100).toFixed(0)}%</span>
                </div>
            </div>

            <div className="signal-reasoning">
                {signal.reasoning_tag}
            </div>
        </div>
    );
}
