interface BackoffOptions {
    maxRetries?: number;      // default: 5
    baseDelayMs?: number;     // default: 1000
    maxDelayMs?: number;      // default: 60000
    jitterFactor?: number;    // default: 0.3
}

export async function withBackoff<T>(
    fn: () => Promise<T>,
    options: BackoffOptions = {}
): Promise<T> {
    const { maxRetries = 5, baseDelayMs = 1000, maxDelayMs = 60_000, jitterFactor = 0.3 } = options;
    let lastError: Error;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            lastError = err;

            // Fast-fail on non-transient errors if it's the first attempt.
            // 429 (Rate Limit) and 503 (Service Unavailable) are always considered transient.
            const isTransient = err?.status === 429 || err?.status === 503 || err?.status === 504 || err?.name === 'AbortError';
            if (!isTransient && attempt === 0) throw err;

            if (attempt < maxRetries) {
                const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
                const jitter = exponential * jitterFactor * Math.random();
                console.warn(`[Backoff] Attempt ${attempt + 1} failed. Retrying in ${Math.floor(exponential + jitter)}ms...`);
                await sleep(Math.floor(exponential + jitter));
            }
        }
    }
    throw lastError!;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
