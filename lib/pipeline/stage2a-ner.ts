/**
 * STAGE 2a — Named Entity Recognition (NER) + Ticker Extraction
 * Uses Gemini 2.5 Pro via puter.ai for primary NER, with GPT-4o-mini fallback.
 */

import { InputArticle, NEREntity, NERResult, SCHEMA_VERSION } from '../types';
import { runWithFallback, NER_CHAIN } from '../models/fallback-chain';
import { isValidTicker } from '../validators/ticker';
import { kvGet, kvSet } from '../cache/kv';

const NER_PROMPT = (article: InputArticle, maxEntities: number) => `
You are a financial Named Entity Recognition engine.

Extract every company, index, commodity, ETF, or cryptocurrency from the article.
For each entity, provide its canonical ticker and a 10-word surrounding_context snippet.

Ticker conventions:
- US stocks: AAPL, MSFT, NVDA
- Share classes: BRK.B, GOOGL
- International: LSE:SHEL, TSE:7203, HKG:0700
- Indices: SPX, NDX, DJI, VIX, FTSE, DAX, NKY
- Commodities: XAUUSD, XAGUSD, CL1, NG1
- Crypto: BTC-USD, ETH-USD, SOL-USD
- ETFs: SPY, QQQ, GLD, TLT

Return ONLY valid JSON. No commentary.

{
  "entities": [
    {
      "name": "string",
      "ticker": "string | null",
      "entity_type": "COMPANY|INDEX|COMMODITY|CRYPTO|MACRO|ETF|UNKNOWN",
      "mention_count": <integer>,
      "primary": <boolean — ONE entity only>,
      "surrounding_context": "<10-word snippet where this entity appears>"
    }
  ]
}

Rules: Never hallucinate tickers. null if unknown. Max ${maxEntities} entities.

SOURCE_CATEGORY: ${article.source_category}
HEADLINE: ${article.headline}
BODY: ${(article.body ?? article.summary).slice(0, 2000)}
`.trim();

export async function runNER(article: InputArticle): Promise<NERResult> {
  // Check cache first
  const cached = await kvGet<NERResult>(`ner:${article.article_id}`);
  if (cached) return cached;

  const maxEntities = 10;
  const prompt = NER_PROMPT(article, maxEntities);

  let result: NERResult;

  try {
    const { response } = await runWithFallback(NER_CHAIN, [{ role: 'user', content: prompt }], { jsonMode: true });
    const parsed = JSON.parse(response);
    result = {
      article_id: article.article_id,
      entities: (parsed.entities ?? []).filter((e: any) => !e.ticker || isValidTicker(e.ticker)),
      schema_version: SCHEMA_VERSION,
    };
  } catch (e) {
    // Fallback chain failed — throw so pipeline caught and DLQ'd
    console.error(`[NER] Fallback chain failed for ${article.article_id}`);
    throw e;
  }

  // Cache for 24 hours
  await kvSet(`ner:${article.article_id}`, result, 86400);
  return result;
}
