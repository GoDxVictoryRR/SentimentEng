'use client';

import React from 'react';
import { SentimentLiquidityIndex } from '../../lib/types';
import { useMacroIndex } from '../../hooks/useMacroIndex';

interface Props {
    regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL' | undefined;
    articleCount: number | undefined;
    cacheHitRate: number | undefined;
    semanticDedupRate: number | undefined;
    lastUpdated: string;
    isRefreshing: boolean;
}

export function SentimentOverview({
    regime,
    articleCount,
    cacheHitRate,
    semanticDedupRate,
    lastUpdated,
    isRefreshing,
}: Props) {
    const { data: macroIndexData } = useMacroIndex();

    // Fallback for color if we still want regime tinting
    const regimeColor = regime === 'RISK_ON'
        ? 'var(--color-bullish)'
        : regime === 'RISK_OFF'
            ? 'var(--color-bearish)'
            : 'var(--color-neutral)';

    return (
        <div className="overview-panel relative overflow-hidden">
            {macroIndexData?.hasJumped && (
                <div className="absolute inset-0 border-2 border-accent-red animate-pulse pointer-events-none rounded-lg" />
            )}
            <div className="overview-header relative z-10">
                <div className="overview-title">
                    <h1>Sentiment Liquidity Engine</h1>
                    <span className="overview-subtitle">Real-time AI-powered market intelligence — <span className="text-accent-blue font-semibold">WorldMonitor Active</span></span>
                </div>
                <div className="overview-status">
                    <span className={`refresh-indicator ${isRefreshing ? 'active' : ''}`} />
                    <span className="last-updated">{lastUpdated}</span>
                </div>
            </div>

            <div className="overview-metrics relative z-10">
                <div className={`metric-card regime-card ${macroIndexData?.hasJumped ? 'bg-accent-red/10 border-accent-red' : ''}`} style={macroIndexData?.hasJumped ? {} : { borderColor: regimeColor }}>
                    <span className="metric-label flex items-center gap-2">
                        Global Instability Index
                        {macroIndexData?.hasJumped && <span className="w-1.5 h-1.5 rounded-full bg-accent-red animate-ping" />}
                    </span>
                    <div className="flex items-end gap-2 text-white">
                        <span className={`text-3xl font-mono font-bold ${macroIndexData?.hasJumped ? 'text-accent-red' : ''}`}>{macroIndexData?.index ?? 50}</span>
                        <span className="text-sm font-mono text-gray-400 mb-1">/ 100</span>
                    </div>
                </div>

                <div className="metric-card">
                    <span className="metric-label">Articles (24h)</span>
                    <span className="metric-value">{articleCount?.toLocaleString() ?? '—'}</span>
                </div>

                <div className="metric-card">
                    <span className="metric-label">Cache Hit Rate</span>
                    <span className="metric-value">{cacheHitRate != null ? `${cacheHitRate}%` : '—'}</span>
                </div>

                <div className="metric-card">
                    <span className="metric-label">Semantic Dedup</span>
                    <span className="metric-value">{semanticDedupRate != null ? `${semanticDedupRate}%` : '—'}</span>
                </div>
            </div>

            {macroIndexData?.risingRisks && macroIndexData.risingRisks.length > 0 && (
                <div className="mt-6 pt-4 border-t border-[#1e2a3e] relative z-10">
                    <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Top 5 Rising Risks</h3>
                    <div className="grid gap-2">
                        {macroIndexData.risingRisks.map((risk, idx) => (
                            <div key={idx} className="flex items-center gap-3 text-sm bg-[#151a23] px-3 py-2 rounded-md border border-[#1e2a3e]">
                                <span className="font-mono text-accent-red font-bold w-10 shrink-0">{risk.points}</span>
                                <span className="text-gray-200 font-medium shrink-0">{risk.title}</span>
                                <span className="text-gray-500 shrink-0">—</span>
                                <span className="text-gray-400 truncate">{risk.driver}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
