/**
 * Validates stock tickers for various exchanges and asset classes.
 * Ensures data integrity before EWMA aggregation.
 */

const TICKER_REGEX = /^[A-Z0-9.\-:]+$/;

export function isValidTicker(ticker: string): boolean {
    if (!ticker || typeof ticker !== 'string') return false;

    const upper = ticker.toUpperCase().trim();
    if (upper.length < 1 || upper.length > 15) return false;

    // Basic character check
    if (!TICKER_REGEX.test(upper)) return false;

    // Exclude common noise/false positives from NER
    const noise = ['INC', 'LTD', 'CORP', 'CO', 'PLC', 'THE', 'AND'];
    if (noise.includes(upper)) return false;

    return true;
}

/**
 * Normalizes ticker strings for consistent KV keys.
 */
export function normalizeTicker(ticker: string): string {
    return ticker.toUpperCase().trim();
}
