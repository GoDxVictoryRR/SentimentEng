'use client';

import React from 'react';
import { useMacroRiskBriefs } from '../../hooks/useMacroRiskBriefs';

export function MacroRiskBriefs() {
    const { data: briefs, isLoading } = useMacroRiskBriefs();

    if (isLoading) {
        return (
            <div className="macro-briefs-panel skeleton">
                <div className="skeleton-header" />
                <div className="skeleton-card" style={{ height: '300px' }} />
            </div>
        );
    }

    if (!briefs || briefs.length === 0) {
        return null;
    }

    return (
        <div className="macro-briefs-panel bg-[#151A23] border border-[#1f2937] rounded-xl p-4 md:p-6 shadow-lg">
            <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[var(--color-primary)]"></span>
                Macro Risk Briefs — Last 24h
            </h2>
            <div className="grid gap-3">
                {briefs.map((brief, i) => {
                    const isHigh = brief.severity === 'High';
                    return (
                        <div
                            key={i}
                            className={`p-3 rounded-lg border transition-all duration-300 hover:bg-[#1a202c] cursor-pointer ${isHigh
                                    ? 'border-accent-red/50 bg-accent-red/5 hover:border-accent-red shadow-[inset_0_0_10px_rgba(255,51,102,0.1)]'
                                    : 'border-[#1f2937] hover:border-[#374151]'
                                }`}
                        >
                            <div className="flex justify-between items-start mb-2">
                                <span className={`text-xs font-bold px-2 py-0.5 rounded flex items-center gap-1.5 ${isHigh
                                        ? 'bg-accent-red text-white shadow-[0_0_10px_rgba(255,51,102,0.5)]'
                                        : brief.severity === 'Med'
                                            ? 'bg-yellow-500 text-black'
                                            : 'bg-green-500 text-black'
                                    }`}>
                                    {isHigh && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                                    {brief.severity.toUpperCase()} RISK
                                </span>
                                <span className="text-xs font-mono text-[var(--color-primary)] bg-[var(--color-primary)]/10 px-2 py-0.5 rounded">
                                    {brief.ticker_impact}
                                </span>
                            </div>
                            <p className="text-sm text-gray-300 leading-snug mb-2">
                                {brief.brief}
                            </p>
                            <div className="text-xs text-gray-500 text-right font-mono">
                                SOURCE // {brief.source}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
