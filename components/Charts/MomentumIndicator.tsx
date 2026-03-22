'use client';

import React from 'react';

interface Props {
    momentum: number;
}

/**
 * Visual momentum indicator with directional arrow and color.
 */
export function MomentumIndicator({ momentum }: Props) {
    const direction = momentum > 0.001 ? 'up' : momentum < -0.001 ? 'down' : 'flat';
    const color = direction === 'up'
        ? 'var(--color-bullish)'
        : direction === 'down'
            ? 'var(--color-bearish)'
            : 'var(--color-neutral)';

    const arrow = direction === 'up' ? '▲' : direction === 'down' ? '▼' : '–';

    return (
        <div className="momentum-indicator" style={{ color }}>
            <span className="momentum-arrow">{arrow}</span>
            <span className="momentum-value">{(Math.abs(momentum ?? 0)).toFixed(4)}</span>
            <span className="momentum-label">momentum</span>
        </div>
    );
}
