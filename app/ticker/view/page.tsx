'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import TickerClientPage from '../[symbol]/TickerClient';

function TickerViewContent() {
    const searchParams = useSearchParams();
    const symbol = searchParams.get('s') || 'AAPL';
    return <TickerClientPage symbol={symbol.toUpperCase()} />;
}

export default function TickerViewPage() {
    return (
        <Suspense fallback={<div>Loading ticker...</div>}>
            <TickerViewContent />
        </Suspense>
    );
}
