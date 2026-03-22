'use client';

import { useState, useEffect } from 'react';

/**
 * Live "Last Updated" timer — shows "Just now", "12s ago", "3m ago", etc.
 * Creates the Bloomberg Terminal feel of always-fresh data.
 */
export function useLastUpdated(lastUpdated: string | undefined): string {
    const [secondsAgo, setSecondsAgo] = useState(0);

    useEffect(() => {
        if (!lastUpdated) return;

        const update = () => {
            setSecondsAgo(Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 1000));
        };

        update(); // Immediate first calculation
        const interval = setInterval(update, 1000);
        return () => clearInterval(interval);
    }, [lastUpdated]);

    if (!lastUpdated) return 'Never';
    if (secondsAgo < 10) return 'Just now';
    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
    return `${Math.floor(secondsAgo / 3600)}h ago`;
}
