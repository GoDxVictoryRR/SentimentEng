'use client';

import React from 'react';

interface Props {
    lastUpdated: string;
    isRefreshing: boolean;
}

export function LastUpdatedTimer({ lastUpdated, isRefreshing }: Props) {
    return (
        <div className="last-updated-timer">
            <span className={`status-dot ${isRefreshing ? 'refreshing' : 'idle'}`} />
            <span className="last-updated-text">{lastUpdated}</span>
        </div>
    );
}
