/**
 * STAGE 2b — Contextual Disambiguation
 * Validates ambiguous tickers (e.g., AAPL = Apple Inc. vs. apple the fruit)
 * using keyword co-occurrence in the article text.
 * Pure local logic — no AI calls needed, fast and deterministic.
 */

import { NEREntity } from '../types';

const FINANCIAL_KEYWORDS = [
    'stock', 'share', 'equity', 'nasdaq', 'nyse', 'exchange', 'listed', 'ticker',
    'earnings', 'revenue', 'profit', 'loss', 'guidance', 'forecast', 'dividend',
    'buyback', 'acquisition', 'merger', 'ipo', 'analyst', 'upgrade', 'downgrade',
    'price target', 'rating', 'quarterly', 'ceo', 'cfo', 'shareholders', 'investors',
    'blockchain', 'defi', 'trading volume', 'market cap',
];

/**
 * Tickers that map to common English words and require disambiguation.
 */
const AMBIGUOUS_TICKERS: Record<string, string> = {
    'AAPL': 'Apple', 'AMZN': 'Amazon', 'GOOGL': 'Google', 'META': 'Meta',
    'SNAP': 'Snap', 'UBER': 'Uber', 'LYFT': 'Lyft', 'PINS': 'Pinterest',
    'GOLD': 'Gold (Barrick)', 'VALE': 'Vale',
};

export function disambiguateEntities(entities: NEREntity[], articleText: string): NEREntity[] {
    const lowerText = articleText.toLowerCase();

    return entities
        .map(entity => {
            if (!entity.ticker) {
                return { ...entity, disambiguation_passed: false, financial_context_score: 0 };
            }

            // Non-ambiguous tickers pass automatically
            if (!(entity.ticker in AMBIGUOUS_TICKERS)) {
                return { ...entity, disambiguation_passed: true, financial_context_score: 1.0 };
            }

            // Ambiguous — score by keyword co-occurrence in surrounding context
            const contextToCheck = (entity.surrounding_context + ' ' + lowerText).toLowerCase();
            const hits = FINANCIAL_KEYWORDS.filter(kw => contextToCheck.includes(kw)).length;
            const score = parseFloat((Math.min(hits / 3, 1.0) ?? 0).toFixed(2));

            return {
                ...entity,
                disambiguation_passed: score >= 0.33,
                financial_context_score: score,
            };
        })
        .filter(e => e.disambiguation_passed);
}
