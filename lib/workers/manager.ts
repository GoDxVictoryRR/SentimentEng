/**
 * Manager Coordinator (TypeScript library version)
 * Used by lib/ code that imports manager logic.
 * The actual worker registration is in puter-worker/manager.js.
 */

import { FeedSource } from '../types';
import { FEED_SOURCES, chunkArray } from '../feeds';
import { kvGet, kvSet } from '../cache/kv';

declare const puter: any;

const N_FETCHER_WORKERS = 10;
const POLL_INTERVAL_MS = 30_000;

/**
 * Triggers a full ingestion cycle.
 */
export async function triggerCycle(prewarm = false): Promise<{ cycleId: string; groups: number } | null> {
    // Anti-spam guard
    const lastRun = await kvGet<number>('poller:last_run');
    if (!prewarm && lastRun && Date.now() - lastRun < POLL_INTERVAL_MS) {
        return null;
    }
    await kvSet('poller:last_run', Date.now());

    const cycleId = crypto.randomUUID();
    const groups = chunkArray(FEED_SOURCES, Math.ceil(FEED_SOURCES.length / N_FETCHER_WORKERS));

    await kvSet(`manager:cycle:${cycleId}:expected`, groups.length, 600);
    await kvSet(`manager:cycle:${cycleId}:done`, 0, 600);

    // Fan out to fetcher workers
    await Promise.allSettled(
        groups.map((group, i) =>
            puter.workers.execute('sentiment-fetcher', { cycleId, groupIndex: i, feeds: group })
        )
    );

    // Trigger pipeline
    await puter.workers.execute('sentiment-pipeline', { cycleId });

    return { cycleId, groups: groups.length };
}
