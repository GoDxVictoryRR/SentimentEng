/**
 * STAGE 1 — Relevance Pre-Filter with Context Caching
 * Batches 16 articles per call to Gemini 2.0 Flash.
 * The system prompt is identical for every call — candidates for Gemini Context Caching.
 * Conservative fallback: if classifier fails, mark all as relevant (never drop articles).
 */

import { InputArticle } from '../types';
import { puterChat, MODELS } from '../models/puter-ai';
import { kvGet, kvSet } from '../cache/kv';

const BATCH_SIZE = 16;

const PREFILTER_SYSTEM_PROMPT = `
You are a financial news relevance classifier for an algorithmic trading pipeline.

Classify each article as financially relevant (true) or irrelevant (false).
An article is RELEVANT if it concerns: stock prices, corporate earnings, M&A activity,
analyst ratings, macroeconomic data, interest rates, commodity prices, regulatory actions,
central bank decisions, or cryptocurrency markets.

An article is IRRELEVANT if it concerns: sports, celebrity news, weather, general politics
unrelated to economics, human interest stories, or science unrelated to tech/pharma.

Return ONLY valid JSON matching this exact schema. No commentary. No markdown.
{ "results": [ { "article_id": "string", "relevant": true | false } ] }
`.trim();

/**
 * Pre-filters a batch of articles for financial relevance.
 */
async function prefilterBatch(
    articles: InputArticle[]
): Promise<Array<{ article_id: string; relevant: boolean }>> {

    const articlesJson = JSON.stringify(
        articles.map(a => ({
            article_id: a.article_id,
            headline: a.headline,
            summary: a.summary?.slice(0, 200),
        }))
    );

    const prompt = `${PREFILTER_SYSTEM_PROMPT}\n\nArticles:\n${articlesJson}`;

    try {
        const raw = await puterChat(MODELS.PREFILTER, [{ role: 'user', content: prompt }], { jsonMode: true });
        const parsed = JSON.parse(raw);
        return parsed.results ?? [];
    } catch {
        // Conservative fallback: mark all as relevant — don't drop articles on classifier failure
        console.warn('[PreFilter] Classifier failed, passing all articles through.');
        return articles.map(a => ({ article_id: a.article_id, relevant: true }));
    }
}

/**
 * Runs pre-filter on all articles in batches of 16.
 * Returns only the relevant articles.
 * Caches results per article_id for 24 hours.
 */
export async function batchPrefilter(articles: InputArticle[]): Promise<InputArticle[]> {
    const relevant: InputArticle[] = [];
    const articleMap = new Map(articles.map(a => [a.article_id, a]));

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < articles.length; i += BATCH_SIZE) {
        const batch = articles.slice(i, i + BATCH_SIZE);

        // Check cache first
        const uncached: InputArticle[] = [];
        for (const article of batch) {
            const cached = await kvGet<boolean>(`relevance:${article.article_id}`);
            if (cached !== null) {
                if (cached) relevant.push(article);
                // Already classified — skip
            } else {
                uncached.push(article);
            }
        }

        if (uncached.length === 0) continue;

        // Run pre-filter on uncached articles
        const results = await prefilterBatch(uncached);

        for (const result of results) {
            await kvSet(`relevance:${result.article_id}`, result.relevant, 86400); // 24hr TTL
            if (result.relevant) {
                const article = articleMap.get(result.article_id);
                if (article) relevant.push(article);
            }
        }
    }

    console.log(`[PreFilter] ${relevant.length}/${articles.length} articles passed relevance filter.`);
    return relevant;
}
