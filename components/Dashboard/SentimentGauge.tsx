'use client';

import React from 'react';

interface Props {
    score: number;
    size?: number;
    label?: string;
}

/**
 * Radial gauge visualizing a sentiment score from -1.0 to +1.0.
 * Uses SVG for crisp rendering at any size.
 */
export function SentimentGauge({ score, size = 120, label }: Props) {
    const normalised = (score + 1) / 2; // 0 to 1
    const angle = normalised * 180 - 90;  // -90 to 90 degrees
    const strokeWidth = size * 0.08;
    const radius = (size / 2) - strokeWidth - 4;
    const cx = size / 2;
    const cy = size / 2;

    // Arc path for the background
    const arcPath = describeArc(cx, cy, radius, -90, 90);

    // Color gradient: red (-1) → yellow (0) → green (+1)
    const hue = normalised * 120; // 0=red, 60=yellow, 120=green
    const color = `hsl(${hue}, 80%, 50%)`;

    return (
        <div className="sentiment-gauge" style={{ width: size, height: size * 0.65 }}>
            <svg width={size} height={size * 0.65} viewBox={`0 0 ${size} ${size * 0.65}`}>
                {/* Background arc */}
                <path
                    d={arcPath}
                    fill="none"
                    stroke="var(--color-surface-2)"
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                />
                {/* Active arc */}
                <path
                    d={describeArc(cx, cy, radius, -90, angle)}
                    fill="none"
                    stroke={color}
                    strokeWidth={strokeWidth}
                    strokeLinecap="round"
                    style={{ filter: `drop-shadow(0 0 4px ${color})` }}
                />
                {/* Needle */}
                <line
                    x1={cx}
                    y1={cy}
                    x2={cx + (radius - 8) * Math.cos((angle * Math.PI) / 180)}
                    y2={cy + (radius - 8) * Math.sin((angle * Math.PI) / 180)}
                    stroke={color}
                    strokeWidth={2}
                    strokeLinecap="round"
                />
                {/* Center dot */}
                <circle cx={cx} cy={cy} r={3} fill={color} />
            </svg>
            <div className="gauge-label">
                <span className="gauge-score" style={{ color }}>{score > 0 ? '+' : ''}{(score ?? 0).toFixed(4)}</span>
                {label && <span className="gauge-title">{label}</span>}
            </div>
        </div>
    );
}

// SVG arc path helper
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const largeArc = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}
