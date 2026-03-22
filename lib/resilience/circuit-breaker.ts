import { kvGet, kvSet } from '../cache/kv';
import { CircuitBreakerState, SCHEMA_VERSION } from '../types';

const FAILURE_THRESHOLD = 5;
const TRIP_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function isCircuitOpen(sourceUrl: string): Promise<boolean> {
    const key = `cb:${hashUrl(sourceUrl)}`;
    const state = await kvGet<CircuitBreakerState>(key);

    if (!state || !state.tripped) return false; // Circuit closed = allow through

    // Check if trip duration has elapsed
    if (state.retry_after) {
        const retryAfter = new Date(state.retry_after).getTime();
        if (Date.now() > retryAfter) {
            // Auto-reset: half-open state — allow one probe through
            await kvSet(key, {
                ...state,
                tripped: false,
                consecutive_failures: 0,
                tripped_at: null,
                retry_after: null
            });
            return false;
        }
    }

    return true; // Still tripped — block the request
}

export async function recordSuccess(sourceUrl: string): Promise<void> {
    const key = `cb:${hashUrl(sourceUrl)}`;
    await kvSet<CircuitBreakerState>(key, {
        source_url: sourceUrl,
        consecutive_failures: 0,
        tripped: false,
        tripped_at: null,
        retry_after: null,
        schema_version: SCHEMA_VERSION,
    });
}

export async function recordFailure(sourceUrl: string): Promise<void> {
    const key = `cb:${hashUrl(sourceUrl)}`;
    const state = await kvGet<CircuitBreakerState>(key) ?? {
        source_url: sourceUrl,
        consecutive_failures: 0,
        tripped: false,
        tripped_at: null,
        retry_after: null,
        schema_version: SCHEMA_VERSION,
    };

    const failures = state.consecutive_failures + 1;
    const shouldTrip = failures >= FAILURE_THRESHOLD;
    const now = new Date().toISOString();

    await kvSet<CircuitBreakerState>(key, {
        ...state,
        consecutive_failures: failures,
        tripped: shouldTrip,
        tripped_at: shouldTrip ? now : state.tripped_at,
        retry_after: shouldTrip
            ? new Date(Date.now() + TRIP_DURATION_MS).toISOString()
            : null,
        schema_version: SCHEMA_VERSION,
    });

    if (shouldTrip) {
        console.warn(`[CircuitBreaker] TRIPPED: ${sourceUrl} after ${failures} failures. Retry after 15min.`);
    }
}

/**
 * Simple stable hash for use as KV key suffix
 */
function hashUrl(url: string): string {
    let h = 0;
    for (let i = 0; i < url.length; i++) {
        h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
    }
    return Math.abs(h).toString(36);
}
