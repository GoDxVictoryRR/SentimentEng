'use client';

import React from 'react';

interface Props {
    volatility: number;
    maxVolatility?: number;
}

/**
 * Horizontal bar showing volatility level with color-graded fill.
 */
export function VolatilityBar({ volatility, maxVolatility = 0.5 }: Props) {
    const pct = Math.min((volatility / maxVolatility) * 100, 100);
    const hue = 120 - (pct * 1.2); // green (low vol) → red (high vol)
    const color = `hsl(${Math.max(0, hue)}, 75%, 50%)`;

    return (
        <div className="volatility-bar-container">
            <div className="volatility-bar-label">
                <span>Volatility</span>
                <span style={{ color }}>{(volatility ?? 0).toFixed(4)}</span>
            </div>
            <div className="volatility-bar-track">
                <div
                    className="volatility-bar-fill"
                    style={{ width: `${pct}%`, backgroundColor: color, boxShadow: `0 0 8px ${color}40` }}
                />
            </div>
        </div>
    );
}
