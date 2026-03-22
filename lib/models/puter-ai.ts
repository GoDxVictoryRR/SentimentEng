import { withBackoff } from '../resilience/backoff';

declare const puter: any;

/**
 * ALL inference and embedding operations go through puter.ai to ensure 
 * the zero-cost developer contract. Billed to the authenticated user's account.
 */

export async function puterChat(
    model: string,
    messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
    options: { jsonMode?: boolean; temperature?: number } = {}
): Promise<string> {
    return await withBackoff(async () => {
        const response = await puter.ai.chat(model, messages, {
            temperature: options.temperature ?? 0.0,
            response_format: options.jsonMode ? { type: 'json_object' } : undefined,
        });
        return response.message.content;
    });
}

export async function puterEmbed(text: string): Promise<number[]> {
    // puter.ai.embed() — zero additional cost to developer
    return await withBackoff(async () => {
        const result = await puter.ai.embed(text.slice(0, 500)); // headlines typically < 500 chars
        return result.embedding;
    });
}

export function cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Model routing constants mapping to puter.ai identifiers.
 */
export const MODELS = {
    PREFILTER: 'gemini-1.5-flash',
    NER: 'gemini-1.5-pro',
    SENTIMENT: 'claude-3-5-sonnet',
    SENTIMENT_FALLBACK: 'deepseek-chat',
    NER_FALLBACK: 'gpt-4o',
} as const;
