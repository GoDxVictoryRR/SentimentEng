// components/Charts/MarketHeatmap.tsx
'use client';

import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import type { SentimentLiquidityIndex } from '../../lib/types';

interface HeatmapEntry extends SentimentLiquidityIndex {
    article_count_24h: number;
    name: string;   // Recharts Treemap requires 'name' field
    size: number;   // Recharts Treemap requires 'size' field for tile sizing
}

interface Props {
    data: Array<SentimentLiquidityIndex & { article_count_24h: number }>;
}

// Map sentiment score (-1.0 → +1.0) to a hex color
// Red (#ef4444) at -1.0, neutral grey (#6b7280) at 0, green (#22c55e) at +1.0
function scoreToColor(score: number): string {
    const clamped = Math.max(-1, Math.min(1, score));
    if (clamped >= 0) {
        // 0 → grey, +1 → green
        const intensity = Math.round(clamped * 255);
        return `rgb(${255 - intensity}, ${Math.min(197 + intensity, 255)}, ${Math.min(94 + intensity, 150)})`;
    } else {
        // 0 → grey, -1 → red
        const intensity = Math.round(Math.abs(clamped) * 255);
        return `rgb(${Math.min(107 + intensity, 239)}, ${Math.max(114 - intensity, 68)}, ${Math.max(128 - intensity, 68)})`;
    }
}

// Custom tile content renderer — shows ticker + score inside each tile
function CustomTile(props: any) {
    const { x, y, width, height, ticker, sentiment_liquidity_score } = props;
    if (width < 30 || height < 20) return null; // too small to render text
    return (
        <g>
            <rect
                x={x} y={y} width={width} height={height}
                fill={scoreToColor(sentiment_liquidity_score)}
                stroke="#1f2937"
                strokeWidth={1}
                rx={3}
            />
            <text x={x + width / 2} y={y + height / 2 - 6} textAnchor="middle" fill="white" fontSize={12} fontWeight="bold">
                {ticker}
            </text>
            <text x={x + width / 2} y={y + height / 2 + 10} textAnchor="middle" fill="white" fontSize={11} opacity={0.85}>
                {sentiment_liquidity_score >= 0 ? '+' : ''}{(sentiment_liquidity_score ?? 0).toFixed(2)}
            </text>
        </g>
    );
}

function CustomTooltip({ active, payload }: any) {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload as HeatmapEntry;
    return (
        <div className="bg-gray-900 border border-gray-700 rounded p-3 text-sm text-white shadow-xl">
            <p className="font-bold text-base mb-1">{d.ticker}</p>
            <p>SL Score: <span style={{ color: scoreToColor(d.sentiment_liquidity_score) }}>{d.sentiment_liquidity_score >= 0 ? '+' : ''}{(d.sentiment_liquidity_score ?? 0).toFixed(4)}</span></p>
            <p>Volatility: {(d.volatility ?? 0).toFixed(4)}</p>
            <p>Momentum: {d.momentum >= 0 ? '+' : ''}{(d.momentum ?? 0).toFixed(4)}</p>
            <p>Articles (24h): {d.article_count_24h}</p>
            <p>Regime: <span className={d.regime === 'RISK_ON' ? 'text-green-400' : d.regime === 'RISK_OFF' ? 'text-red-400' : 'text-gray-400'}>{d.regime}</span></p>
        </div>
    );
}

export default function MarketHeatmap({ data }: Props) {
    const heatmapData: HeatmapEntry[] = data.map(d => ({
        ...d,
        name: d.ticker,
        size: Math.max(d.article_count_24h, 1), // Treemap requires size > 0
    }));

    if (heatmapData.length === 0) {
        return (
            <div className="flex items-center justify-center h-64 bg-gray-900 rounded-xl border border-gray-800 text-gray-500">
                No ticker data available yet
            </div>
        );
    }

    return (
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="flex justify-between items-center mb-3">
                <h2 className="text-white font-semibold text-sm uppercase tracking-wide">Market Heatmap</h2>
                <div className="flex items-center gap-3 text-xs text-gray-400">
                    <span>Tile size = article volume</span>
                    <span className="flex items-center gap-1">
                        <span className="inline-block w-3 h-3 rounded-sm bg-red-500" /> Bearish
                        <span className="inline-block w-3 h-3 rounded-sm bg-gray-500 ml-2" /> Neutral
                        <span className="inline-block w-3 h-3 rounded-sm bg-green-500 ml-2" /> Bullish
                    </span>
                </div>
            </div>
            <ResponsiveContainer width="100%" height={320}>
                <Treemap
                    data={heatmapData}
                    dataKey="size"
                    content={<CustomTile />}
                >
                    <Tooltip content={<CustomTooltip />} />
                </Treemap>
            </ResponsiveContainer>
        </div>
    );
}
