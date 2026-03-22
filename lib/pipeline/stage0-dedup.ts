/**
 * STAGE 0 — Dual Deduplication
 * Pass 1: SHA256 exact hash of headline+published_at (free, instant).
 * Pass 2: puter.ai.embed() cosine similarity for semantic near-dupe detection.
 * Uses decreasing timestamp prefix keys so kv.list() returns newest first.
 */

import { InputArticle } from '../types';
import { puterEmbed, cosineSimilarity } from '../models/puter-ai';
import { kvGet, kvSet, kvListPrefix } from '../cache/kv';

const SEMANTIC_THRESHOLD = 0.92;
const SEMANTIC_WINDOW = 200; // Only compare against 200 most recent embeddings
const MAX_TS = Number.MAX_SAFE_INTEGER; // 9007199254740991

/**
 * SHA256 hash using the Web Crypto API (browser-native, no Node.js crypto needed).
 */
async function sha256(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * MD5-like short hash for embedding key suffixes.
 * Uses a simple FNV-1a variant — not cryptographic, just for key uniqueness.
 */
function shortHash(embedding: number[]): string {
    const str = embedding.slice(0, 8).map(v => Math.round(v * 100)).join(',');
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(36).slice(0, 12);
}

export async function deduplicate(article: InputArticle): Promise<'EXACT_HIT' | 'SEMANTIC_HIT' | 'MISS'> {

    // ── PASS 1 — Exact SHA256 (free, instant) ──
    const exactHash = await sha256(article.headline + article.published_at);

    if (await kvGet<string>(`hash:${exactHash}`)) return 'EXACT_HIT';
    await kvSet(`hash:${exactHash}`, '1', 172800); // 48hr TTL

    // ── PASS 2 — Semantic similarity (high-volume categories only) ──
    if (['markets', 'macro'].includes(article.source_category)) {
        const embedding = await puterEmbed(article.headline);

        // Decreasing timestamp prefix — recent entries sort FIRST in kv.list()
        // MAX_TS - now() produces smaller numbers for more recent timestamps.
        // Lexicographic ascending sort → newest articles at top automatically.
        const allKeys = await kvListPrefix('semhash:');
        const recentKeys = allKeys.slice(0, SEMANTIC_WINDOW);

        for (const key of recentKeys) {
            const stored = await kvGet<{ embedding: number[]; article_id: string }>(key);
            if (!stored) continue;
            if (cosineSimilarity(embedding, stored.embedding) >= SEMANTIC_THRESHOLD) {
                return 'SEMANTIC_HIT';
            }
        }

        // Write with decreasing timestamp prefix for correct future ordering
        const decreasingTs = MAX_TS - Date.now();
        const embHash = shortHash(embedding);

        // Pad to 16 digits so lexicographic sort works correctly across all magnitudes
        const paddedTs = String(decreasingTs).padStart(16, '0');

        await kvSet(
            `semhash:${paddedTs}:${embHash}`,
            { embedding, article_id: article.article_id },
            172800 // 48hr TTL
        );
    }

    return 'MISS';
}
