/**
 * Prewarm Module
 * Triggers a pipeline cycle if the cache is cold or stale.
 * Anti-storm guard ensures only one prewarm triggers per 5 minutes.
 */

import { kvGet, kvSet } from '../cache/kv';

declare const puter: any;

const PREWARM_COOLDOWN_SECONDS = 300; // 5 minutes

/**
 * Triggers a prewarm cycle if cooldown has elapsed.
 * Called from the frontend on mount to ensure data is available.
 */
export async function triggerPrewarm(): Promise<boolean> {
    const lastPrewarm = await kvGet<number>('prewarm:last');

    if (lastPrewarm && Date.now() - lastPrewarm < PREWARM_COOLDOWN_SECONDS * 1000) {
        console.log('[Prewarm] Cooldown active, skipping.');
        return false;
    }

    await kvSet('prewarm:last', Date.now(), PREWARM_COOLDOWN_SECONDS);

    try {
        // Trigger the manager worker — which fans out to fetchers and then pipeline
        await puter.workers.execute('sentiment-manager', { prewarm: true });
        console.log('[Prewarm] Manager triggered successfully.');
        return true;
    } catch (e) {
        console.error('[Prewarm] Failed to trigger manager:', e);
        // Try fallback alias
        try {
            await puter.workers.exec('sentiment-manager', { prewarm: true });
            return true;
        } catch {
            return false;
        }
    }
}
