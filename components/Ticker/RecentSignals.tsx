'use client';

import React from 'react';
import { SentimentScore } from '../../lib/types';
import { SignalCard } from './SignalCard';

interface Props {
    signals: SentimentScore[];
}

export function RecentSignals({ signals }: Props) {
    if (signals.length === 0) {
        return (
            <div className="recent-signals-panel">
                <h3>Recent Signals</h3>
                <div className="empty-state">
                    <p>No signals recorded yet for this ticker.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="recent-signals-panel">
            <h3>Recent Signals</h3>
            <div className="signals-list">
                {signals.slice(0, 20).map((signal, i) => (
                    <SignalCard key={i} signal={signal} />
                ))}
            </div>
        </div>
    );
}
