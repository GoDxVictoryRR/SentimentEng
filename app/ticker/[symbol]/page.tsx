import TickerClient from './TickerClient';

export function generateStaticParams() {
    return [{ symbol: 'AAPL' }];
}

export default function TickerPage({ params }: { params: { symbol: string } }) {
    return <TickerClient symbol={params.symbol} />;
}
