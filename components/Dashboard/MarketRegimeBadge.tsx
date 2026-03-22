'use client';

import React from 'react';

interface Props {
    regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
}

export function MarketRegimeBadge({ regime }: Props) {
    const config = {
        RISK_ON: { label: 'RISK ON', icon: '🟢', className: 'regime-bullish' },
        RISK_OFF: { label: 'RISK OFF', icon: '🔴', className: 'regime-bearish' },
        NEUTRAL: { label: 'NEUTRAL', icon: '⚪', className: 'regime-neutral' },
    };

    const { label, icon, className } = config[regime];

    return (
        <div className={`market-regime-badge ${className}`}>
            <span className="regime-icon">{icon}</span>
            <span className="regime-label">{label}</span>
        </div>
    );
}
