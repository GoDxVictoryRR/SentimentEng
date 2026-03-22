'use client';

import React, { useState, useMemo, useEffect } from 'react';
import DeckGL from '@deck.gl/react';
import { GeoJsonLayer, ScatterplotLayer } from '@deck.gl/layers';
import { _GlobeView as GlobeView } from '@deck.gl/core';

// Hardcoded rough coordinates for common macro risk hotspots to ensure the pulses show up
const HOTSPOTS: Record<string, [number, number]> = {
    'Taiwan': [120.9605, 23.6978],
    'Israel': [34.8516, 31.0461],
    'Ukraine': [31.1656, 48.3794],
    'Russia': [105.3188, 61.5240],
    'China': [104.1954, 35.8617],
    'United States': [-95.7129, 37.0902],
    'Iran': [53.6880, 32.4279],
    'Red Sea': [38.2723, 20.2528],
    'Middle East': [43.6793, 25.5560],
    'Europe': [15.2551, 54.5260]
};

const INITIAL_VIEW_STATE = {
    longitude: 0,
    latitude: 20,
    zoom: 1,
    pitch: 0,
    bearing: 0
};

export function GlobalExposureMap() {
    const [exposureData, setExposureData] = useState<any>({});
    const [hoverInfo, setHoverInfo] = useState<any>(null);

    useEffect(() => {
        let p = (window as any).puter;
        if (p?.kv) {
            p.kv.get('macro:exposure').then((raw: string) => {
                if (raw) setExposureData(JSON.parse(raw).value || {});
            }).catch(console.error);
        }
    }, []);

    // Generate layers
    const layers = useMemo(() => {
        const countryPoints = Object.entries(exposureData).map(([country, data]: [string, any]) => {
            const coords = HOTSPOTS[country] || [Math.random() * 360 - 180, Math.random() * 140 - 70]; // Fallback random if not found
            return {
                country,
                coordinates: coords,
                score: data.score || 50,
                affected_tickers: data.affected_tickers || [],
                volume: data.volume || Math.floor(Math.random() * 50) + 10 // Mock volume if not provided
            };
        });

        return [
            // Base globe (dark landmasses)
            new GeoJsonLayer({
                id: 'base-map',
                data: 'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_110m_admin_0_countries.geojson',
                // Styles
                stroked: true,
                filled: true,
                lineWidthMinPixels: 1,
                getLineColor: [30, 42, 62],
                getFillColor: [15, 21, 32]
            }),

            // Pulsing hotspots
            new ScatterplotLayer({
                id: 'exposure-pulses',
                data: countryPoints,
                pickable: true,
                opacity: 0.8,
                stroked: true,
                filled: true,
                radiusScale: 10000,
                radiusMinPixels: 5,
                radiusMaxPixels: 50,
                lineWidthMinPixels: 2,
                getPosition: d => d.coordinates,
                getFillColor: d => d.score > 80 ? [255, 51, 102, 180] : [255, 170, 0, 180], // Red for high risk, orange/yellow otherwise
                getLineColor: d => d.score > 80 ? [255, 51, 102] : [255, 170, 0],
                getRadius: d => d.volume * 2,
                onHover: info => setHoverInfo(info)
            })
        ];
    }, [exposureData]);

    return (
        <div className="relative w-full h-[600px] bg-[#0a0e17] rounded-xl overflow-hidden border border-[#1e2a3e] shadow-2xl">
            {/* Overlay Header */}
            <div className="absolute top-4 left-4 z-10 pointer-events-none">
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-accent-blue animate-pulse"></span>
                    Global Sentiment Exposure
                </h2>
                <p className="text-sm text-gray-400 mt-1">Real-time geopolitical impact routing</p>
            </div>

            <DeckGL
                views={new GlobeView({ resolution: 2 })}
                initialViewState={INITIAL_VIEW_STATE}
                controller={true}
                layers={layers}
                getCursor={() => hoverInfo?.object ? 'pointer' : 'grab'}
            />

            {/* Hover Tooltip */}
            {hoverInfo && hoverInfo.object && (
                <div
                    className="absolute z-50 pointer-events-none bg-[#151a23] border border-[#1e2a3e] p-4 rounded-lg shadow-2xl min-w-[200px]"
                    style={{ left: hoverInfo.x + 15, top: hoverInfo.y + 15 }}
                >
                    <h3 className="font-bold text-lg text-white mb-1 uppercase">{hoverInfo.object.country}</h3>
                    <div className="flex items-center gap-2 mb-3">
                        <span className="text-xs font-mono text-gray-400">RISK SCORE:</span>
                        <span className={`text-sm font-mono font-bold ${hoverInfo.object.score > 80 ? 'text-accent-red' : 'text-yellow-500'}`}>
                            {hoverInfo.object.score}/100
                        </span>
                    </div>

                    <div className="mb-2">
                        <span className="text-xs font-mono text-gray-500 mb-1 block">AFFECTED TICKERS</span>
                        <div className="flex flex-wrap gap-1">
                            {hoverInfo.object.affected_tickers.map((t: string) => (
                                <span key={t} className="px-1.5 py-0.5 bg-accent-blue/10 text-accent-blue rounded text-xs font-bold ring-1 ring-accent-blue/30">
                                    {t}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Map Legend */}
            <div className="absolute bottom-4 left-4 z-10 bg-[#151a23]/80 backdrop-blur border border-[#1e2a3e] rounded-lg p-3 text-xs flex flex-col gap-2">
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-accent-red opacity-80 ring-1 ring-accent-red"></span>
                    <span className="text-gray-300 font-medium">High Impact (Score &gt; 80)</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-yellow-500 opacity-80 ring-1 ring-yellow-500"></span>
                    <span className="text-gray-300 font-medium">Elevated Risk</span>
                </div>
                <div className="flex items-center gap-2 mt-1 pt-1 border-t border-[#1e2a3e]">
                    <span className="w-3 h-3 rounded-full bg-transparent border border-gray-500 border-dashed"></span>
                    <span className="text-gray-400">Size = Article Volume</span>
                </div>
            </div>
        </div>
    );
}
