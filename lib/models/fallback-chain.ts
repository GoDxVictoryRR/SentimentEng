/**
 * Model Fallback Chain
 * Orchestrates multi-model inference with automatic fallback.
 * All calls go through puter.ai — developer holds zero API keys.
 */

import { puterChat, MODELS } from './puter-ai';

export type ModelChain = readonly string[];

export const NER_CHAIN: ModelChain = [MODELS.NER, MODELS.NER_FALLBACK] as const;
export const SENTIMENT_CHAIN: ModelChain = [MODELS.SENTIMENT, MODELS.SENTIMENT_FALLBACK] as const;

/**
 * Tries each model in the chain until one succeeds.
 * Returns the raw response string from the first successful model.
 */
export async function runWithFallback(
    chain: ModelChain,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options: { jsonMode?: boolean; temperature?: number } = {}
): Promise<{ response: string; modelUsed: string }> {
    let lastError: Error | null = null;

    for (const model of chain) {
        try {
            const response = await puterChat(model, messages, options);
            return { response, modelUsed: model };
        } catch (e) {
            lastError = e as Error;
            console.warn(`[FallbackChain] Model ${model} failed, trying next...`);
        }
    }

    throw lastError ?? new Error('[FallbackChain] All models in chain failed.');
}
