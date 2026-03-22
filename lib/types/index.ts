export const SCHEMA_VERSION = '1.3' as const;

export interface InputArticle {
  article_id: string;
  source: string;
  source_tier: 1 | 2 | 3;
  source_weight: number;
  source_category: 'markets' | 'macro' | 'crypto' | 'commodities' | 'geopolitical';
  headline: string;
  summary: string;
  body: string | null;
  published_at: string;
  feed_url: string;
  market_session: 'PRE_MARKET' | 'MARKET_HOURS' | 'AFTER_HOURS' | 'WEEKEND';
  schema_version: typeof SCHEMA_VERSION;
}

export interface NEREntity {
  name: string;
  ticker: string | null;
  entity_type: 'COMPANY' | 'INDEX' | 'COMMODITY' | 'CRYPTO' | 'MACRO' | 'ETF' | 'UNKNOWN';
  mention_count: number;
  primary: boolean;
  surrounding_context: string;
  disambiguation_passed: boolean;
  financial_context_score: number;
}

export interface NERResult {
  article_id: string;
  entities: NEREntity[];
  schema_version: typeof SCHEMA_VERSION;
}

export interface SentimentScore {
  ticker: string;
  sentiment_score: number;
  confidence: number;
  signal_type: 'EARNINGS' | 'ANALYST' | 'REGULATORY' | 'MA' | 'MACRO' |
  'GEOPOLITICAL' | 'SUPPLY_CHAIN' | 'MANAGEMENT' | 'PRODUCT' | 'LEGAL' | 'OTHER';
  time_horizon: 'INTRADAY' | 'SHORT_TERM' | 'MEDIUM_TERM' | 'LONG_TERM';
  reasoning_tag: string;
}

export interface SentimentResult {
  article_id: string;
  scores: SentimentScore[];
  market_regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
  schema_version: typeof SCHEMA_VERSION;
}

export interface SentimentLiquidityIndex {
  ticker: string;
  sentiment_liquidity_score: number;
  ewma: number;
  volatility: number;
  momentum: number;
  article_signal_strength: number;
  n: number;
  lastUpdated: string;
  regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
  market_session: string;
  schema_version: typeof SCHEMA_VERSION;
}

export interface CircuitBreakerState {
  source_url: string;
  consecutive_failures: number;
  tripped: boolean;
  tripped_at: string | null;
  retry_after: string | null;   // ISO8601 — when to allow retries again
  schema_version: typeof SCHEMA_VERSION;
}

export interface DistributedLock {
  ticker: string;
  locked_at: string;
  worker_id: string;
  schema_version: typeof SCHEMA_VERSION;
}

export interface DLQEntry {
  article_id: string;
  headline: string;
  failed_stage: 'PREFILTER' | 'NER' | 'DISAMBIGUATION' | 'SENTIMENT';
  error_message: string;
  failed_at: string;
  retry_count: number;
  schema_version: typeof SCHEMA_VERSION;
}

export interface FeedSource {
  url: string;
  name: string;
  tier: 1 | 2 | 3;
  weight: number;
  format: 'rss' | 'json';
  category: 'markets' | 'macro' | 'crypto' | 'commodities' | 'geopolitical';
}

export interface OverviewResponse {
  timestamp: string;
  market_regime: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
  total_articles_processed_24h: number;
  cache_hit_rate: number;
  semantic_dedup_rate: number;
  top_movers: SentimentLiquidityIndex[];
}

export interface TickerResponse {
  current: SentimentLiquidityIndex;
  history_24h: SentimentLiquidityIndex[];
  recent_signals: SentimentScore[];
  timeline_events?: any[];
}
