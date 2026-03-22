import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
    title: 'Sentiment Liquidity Engine v1.4.1',
    description: 'Real-time sentiment-driven liquidity engine powered by Puter AI and KV',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <head>
                <link
                    href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap"
                    rel="stylesheet"
                />
            </head>
            <body>
                <nav className="nav-bar">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <div className="w-4 h-4 rounded-sm bg-gradient-to-tr from-accent-purple to-accent-blue opacity-80" />
                            <h1 className="text-xl font-bold tracking-tight text-text-primary">SentimentCore</h1>
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-bg-card border border-border-light text-text-accent">v1.4.4</span>
                        </div>
                    </div>
                    <div className="nav-links">
                        <a href="/" className="nav-link">Dashboard</a>
                    </div>
                </nav>
                <div className="app-container">
                    {children}
                </div>
                <footer className="app-footer">
                    <p className="disclaimer">
                        ⚠️ Signals are experimental and not financial advice.
                        Powered by Puter.js — zero-cost AI inference.
                    </p>
                </footer>
                <script src="https://js.puter.com/v2/" defer></script>
            </body>
        </html>
    );
}
