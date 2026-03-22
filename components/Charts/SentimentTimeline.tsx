'use client';

import React from 'react';
import { SentimentLiquidityIndex } from '../../lib/types';

interface Props {
    history: SentimentLiquidityIndex[];
    events?: any[];
}

export function SentimentTimeline({ history, events = [] }: Props) {
    if (history.length < 2 && events.length === 0) {
        return (
            <div className="chart-panel timeline-chart">
                <h3>24h Sentiment Timeline</h3>
                <div className="empty-state">
                    <p>Collecting data points…</p>
                </div>
            </div>
        );
    }

    const width = 600;
    const height = 200;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    const scores = history.map(h => h.sentiment_liquidity_score);
    const minScore = scores.length > 0 ? Math.min(-0.5, ...scores) : -0.5;
    const maxScore = scores.length > 0 ? Math.max(0.5, ...scores) : 0.5;
    const range = maxScore - minScore || 1;

    const points = history.map((h, i) => {
        const x = padding.left + (i / (history.length - 1)) * chartW;
        const y = padding.top + chartH - ((h.sentiment_liquidity_score - minScore) / range) * chartH;
        return { x, y, score: h.sentiment_liquidity_score };
    });

    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

    // Safety check for path
    const areaPath = points.length > 0
        ? `${linePath} L ${points[points.length - 1].x} ${padding.top + chartH} L ${points[0].x} ${padding.top + chartH} Z`
        : '';

    const zeroY = padding.top + chartH - ((0 - minScore) / range) * chartH;
    const lastScore = scores.length > 0 ? scores[scores.length - 1] : 0;
    const lineColor = lastScore > 0 ? 'var(--color-bullish)' : lastScore < 0 ? 'var(--color-bearish)' : 'var(--color-neutral)';

    return (
        <div className="chart-panel timeline-chart">
            <h3>24h Sentiment Timeline</h3>

            {/* SVG Sparkline (if history exists) */}
            {points.length > 0 && (
                <div className="mb-6 hidden md:block">
                    <svg viewBox={`0 0 ${width} ${height}`} className="timeline-svg w-full max-h-[150px]">
                        <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke="var(--color-border)" strokeDasharray="4,4" strokeWidth={1} />
                        <path d={areaPath} fill={lineColor} opacity={0.1} />
                        <path d={linePath} fill="none" stroke={lineColor} strokeWidth={2} />
                        {points.map((p, i) => (
                            <circle key={i} cx={p.x} cy={p.y} r={3} fill={lineColor} className="data-point">
                                <title>{(p.score ?? 0).toFixed(4)}</title>
                            </circle>
                        ))}
                    </svg>
                </div>
            )}

            {/* Mixed Events Timeline */}
            {events && events.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#1e2a3e]">
                    <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Event Flow</h4>
                    <div className="flex flex-col gap-3 relative before:absolute before:inset-y-0 before:left-2 before:w-[2px] before:bg-[#1e2a3e]">
                        {events.map((evt, idx) => (
                            <div key={idx} className="relative pl-8 group cursor-help">
                                {/* Timeline Dot */}
                                <div className={`absolute left-1 top-1.5 w-2.5 h-2.5 rounded-full ${evt.type === 'macro' ? 'bg-accent-purple' : 'bg-accent-blue'} ring-4 ring-[#151a23] z-10 transition-transform group-hover:scale-125`} />

                                <div className="flex items-start gap-4 p-3 bg-[#151a23] rounded-lg border border-[#1e2a3e] group-hover:border-[#374151] transition-colors relative">
                                    <div className="flex-1">
                                        <div className="flex justify-between mb-1">
                                            <span className={`text-xs font-bold uppercase tracking-wider ${evt.type === 'macro' ? 'text-accent-purple' : 'text-accent-blue'}`}>
                                                {evt.type === 'macro' ? 'MACRO' : 'STOCK'} • {evt.ticker}
                                            </span>
                                            <span className="text-xs text-gray-500 font-mono">{evt.time_ago}</span>
                                        </div>
                                        <p className="text-sm font-medium text-gray-200 mb-1">{evt.event}</p>
                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${evt.impact === 'positive' ? 'bg-green-500/20 text-green-400' : 'bg-accent-red/20 text-accent-red'}`}>
                                            {evt.impact}
                                        </span>
                                    </div>

                                    {/* Hover Tooltip - AI One Liner */}
                                    <div className="absolute right-0 top-full mt-2 w-64 p-3 bg-black border border-accent-blue rounded-lg text-xs leading-relaxed text-blue-100 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-[0_4px_20px_rgba(40,112,253,0.3)]">
                                        <span className="font-mono text-accent-blue block mb-1">AI_ANALYSIS</span>
                                        {evt.ai_impact_summary}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
