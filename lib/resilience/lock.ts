import { kvGet, kvSet, kvIncrement, kvDecrement, kvDel } from '../cache/kv';

const LOCK_TTL_SECONDS = 5;        // auto-expires — prevents deadlock on worker crash
const LOCK_RETRY_INTERVAL_MS = 75;
const LOCK_MAX_WAIT_MS = 2000;

/**
 * Acquires a distributed lock for a ticker using atomic increment.
 * count === 1 means lock is acquired. count > 1 means another worker holds it.
 */
export async function acquireLock(ticker: string): Promise<boolean> {
    const key = `lock:${ticker}`;
    const deadline = Date.now() + LOCK_MAX_WAIT_MS;

    while (Date.now() < deadline) {
        // ATOMIC: kvIncrement uses puter.kv.incr() server-side — no TOCTOU race possible
        const count = await kvIncrement(key);

        if (count === 1) {
            // Sole owner — set TTL metadata to detect stale locks if worker crashes
            await kvSet(`lock:meta:${ticker}`, { acquired_at: Date.now() }, LOCK_TTL_SECONDS);
            return true;
        }

        // count > 1 — another worker holds the lock.
        // Decrement back to avoid permanently inflating the counter.
        await kvDecrement(key);

        // Check if the lock is stale (holder crashed without releasing)
        const meta = await kvGet<{ acquired_at: number }>(`lock:meta:${ticker}`);
        if (!meta) {
            // Meta expired → TTL elapsed → lock is stale, delete and retry immediately
            // This is a safety measure if the worker crashed before releasing or before setting meta.
            await kvDel(key);
            continue;
        }

        // Lock is held — wait with jitter and retry
        await sleep(LOCK_RETRY_INTERVAL_MS + Math.random() * 50);
    }

    return false; // timeout
}

export async function releaseLock(ticker: string): Promise<void> {
    await kvDel(`lock:${ticker}`);
    await kvDel(`lock:meta:${ticker}`);
}

/**
 * Higher-order function to execute logic within a distributed lock.
 */
export async function withLock<T>(
    ticker: string,
    fn: () => Promise<T>
): Promise<T> {
    const acquired = await acquireLock(ticker);
    if (!acquired) {
        throw new Error(`[Lock] Could not acquire lock for ${ticker} within ${LOCK_MAX_WAIT_MS}ms`);
    }
    try {
        return await fn();
    } finally {
        await releaseLock(ticker);
    }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
