/**
 * STAGE 3 — Per-Ticker Sentiment Scoring
 * Uses Claude Sonnet via puter.ai for primary scoring, with DeepSeek fallback.
 * Produces a quantitative sentiment score per entity, with confidence and signal classification.
 */

import { InputArticle, NEREntity, SentimentScore, SentimentResult, SCHEMA_VERSION } from '../types';
import { runWithFallback, SENTIMENT_CHAIN } from '../models/fallback-chain';
import { isValidTicker } from '../validators/ticker';
import { kvGet, kvSet } from '../cache/kv';

const SENTIMENT_PROMPT = (article: InputArticle, entities: NEREntity[]) => `
You are a quantitative financial sentiment analyzer feeding algorithmic trading signals.
Score sentiment for EACH entity as it specifically affects that entity's stock price direction.

Sentiment scale:
+1.0 = Extremely bullish (massive earnings beat, buyout at large premium)
+0.5 = Moderately bullish (analyst upgrade, positive guidance revision)
 0.0 = Neutral
-0.5 = Moderately bearish (analyst downgrade, weak guidance)
-1.0 = Extremely bearish (fraud allegations, bankruptcy, major regulatory penalty)

Confidence guide:
1.0 = Direct unambiguous statement ("X beats estimates by 30%")
0.7 = Clear implication ("analysts broadly optimistic on X")
0.5 = Indirect / speculative
0.3 = Tangential mention
0.1 = Barely mentioned

Source weight: ${article.source_weight} | Category: ${article.source_category} | Session: ${article.market_session}

Return ONLY valid JSON:
{
  "scores": [{
    "ticker": "string",
    "sentiment_score": <float 2dp -1.0 to 1.0>,
    "confidence": <float 2dp 0.0 to 1.0>,
    "signal_type": "EARNINGS|ANALYST|REGULATORY|MA|MACRO|GEOPOLITICAL|SUPPLY_CHAIN|MANAGEMENT|PRODUCT|LEGAL|OTHER",
    "time_horizon": "INTRADAY|SHORT_TERM|MEDIUM_TERM|LONG_TERM",
    "reasoning_tag": "<3–8 word driver>"
  }],
  "market_regime": "RISK_ON|RISK_OFF|NEUTRAL"
}

Entities (disambiguation pre-validated):
${JSON.stringify(entities.map(e => ({ ticker: e.ticker, name: e.name, primary: e.primary })))}

HEADLINE: ${article.headline}
PUBLISHED: ${article.published_at}
BODY: ${(article.body ?? article.summary).slice(0, 2000)}
`.trim();

export async function runSentiment(article: InputArticle, entities: NEREntity[]): Promise<SentimentResult> {
    // Check cache first
    const cached = await kvGet<SentimentResult>(`sentiment:${article.article_id}`);
    if (cached) return cached;

    if (entities.length === 0) {
        return { article_id: article.article_id, scores: [], market_regime: 'NEUTRAL', schema_version: SCHEMA_VERSION };
    }

    const prompt = SENTIMENT_PROMPT(article, entities);

    let parsed;
    try {
        const { response } = await runWithFallback(SENTIMENT_CHAIN, [{ role: 'user', content: prompt }], { jsonMode: true });
        parsed = JSON.parse(response);
    } catch (e) {
        console.error(`[Sentiment] Fallback chain failed for ${article.article_id}`);
        throw e;
    }

    const scores: SentimentScore[] = (parsed.scores ?? []).filter((s: any) =>
        isValidTicker(s.ticker) &&
        typeof s.sentiment_score === 'number' && Math.abs(s.sentiment_score) <= 1.0 &&
        typeof s.confidence === 'number' && s.confidence >= 0 && s.confidence <= 1.0
    );

    const result: SentimentResult = {
        article_id: article.article_id,
        scores,
        market_regime: parsed.market_regime ?? 'NEUTRAL',
        schema_version: SCHEMA_VERSION,
    };

    // Cache for 24 hours
    await kvSet(`sentiment:${article.article_id}`, result, 86400);
    return result;
}
