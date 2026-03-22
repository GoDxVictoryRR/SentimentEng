/**
 * puter.kv has no native TTL. This wrapper implements a manual TTL layer.
 * All KV interactions must go through these functions to ensure schema consistency.
 *
 * Current non-TTL keys:
 * | `session:heartbeat`  | none  | Session liveness ping — written every 4 min |
 */

import { ensureSession } from '../resilience/session';

declare const puter: any; // Puter SDK is available globally in the environment

interface KVEntry<T> {
    value: T;
    expiresAt: number | null;
    schema_version: '1.3';
}

export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await ensureSession();
    const entry: KVEntry<T> = {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
        schema_version: '1.3',
    };
    await puter.kv.set(key, JSON.stringify(entry));
}

export async function kvGet<T>(key: string): Promise<T | null> {
    await ensureSession();
    try {
        const raw = await puter.kv.get(key);
        if (!raw) return null;
        const entry: KVEntry<T> = JSON.parse(raw);

        // Check manual TTL
        if (entry.expiresAt && Date.now() > entry.expiresAt) {
            await puter.kv.del(key);
            return null;
        }
        return entry.value;
    } catch (err) {
        console.error(`[KV] Error getting key ${key}:`, err);
        return null;
    }
}

export async function kvDel(key: string): Promise<void> {
    await puter.kv.del(key);
}

/**
 * Atomic increment using puter.kv.incr()
 * Note: puter.kv.incr() is server-side atomic.
 */
export async function kvIncrement(key: string, ttlSeconds?: number): Promise<number> {
    // We use the native incr() for atomicity, but we still want our TTL metadata if possible.
    // However, native incr() doesn't support our KVEntry wrapper easily.
    // For counters used in locks/cycles, we often use the native value directly.
    // But for the sake of consistency with kvGet, we'll try to keep them compatible or use separate namespaces.

    // Rule: Keys with 'lock:' or 'manager:cycle:' prefixes use native incr directly.
    const count = await puter.kv.incr(key);
    return count;
}

/**
 * Decrement utility (native puter.kv.decr)
 */
export async function kvDecrement(key: string): Promise<number> {
    return await puter.kv.decr(key);
}

/**
 * List keys with a prefix, returned in raw KV order (lexicographic)
 */
export async function kvListPrefix(prefix: string): Promise<string[]> {
    try {
        return await puter.kv.list(prefix);
    } catch (err) {
        console.error(`[KV] Error listing prefix ${prefix}:`, err);
        return [];
    }
}
