# HIGH-THROUGHPUT AI SENTIMENT LIQUIDITY ENGINE
## Master Build Prompt — v1.4.0
### For: Google Antigravity

> You are a senior full-stack engineer and AI systems architect.
> Build this project completely, end-to-end, from scratch.
> Do not ask clarifying questions. Make all reasonable implementation decisions independently.
> Deliver production-quality code with inline comments explaining every architectural decision.

---

## 1. PROJECT OVERVIEW

Build a **High-Throughput AI Sentiment Liquidity Engine** — a real-time financial intelligence platform that ingests 100+ global news feeds, runs a multi-model AI pipeline to extract ticker-mapped sentiment signals, and displays a live "Sentiment Liquidity Index" dashboard for traders.

**The core insight:** Markets move faster than humans can read. This system quantifies market sentiment across thousands of news articles per hour into a single normalized score per stock ticker, updated continuously.

**Stack:**
- **Frontend:** Next.js 14 (App Router) + Recharts + SWR
- **Backend/Workers:** Puter.js native workers (`puter.workers.execute()`, `puter.ai`, `puter.kv`)
- **AI Models:** Gemini 2.0 Flash (pre-filter) → Gemini 2.5 Pro (NER + disambiguation) → Claude Sonnet / DeepSeek (sentiment)
- **Embeddings:** `puter.ai.embed()` — zero additional cost, billed to user's Puter account
- **Storage:** `puter.kv` — global distributed key-value cache
- **Resource Model:** Puter.js User-Pays — ALL compute billed to authenticated user's Puter account. Developer pays zero. No external API keys held by the platform.

---

## 2. CRITICAL ARCHITECTURE CONSTRAINTS

Read these before writing a single line of code. Violations will break the entire system.

### Constraint 1 — True Zero-Cost Model
**WRONG:** `process.env.OPENAI_API_KEY` for embeddings — developer pays, kills the zero-cost promise.
**RIGHT:** Use `puter.ai.embed(text)` exclusively for all embedding operations. This charges the authenticated user's Puter account, not the developer. The developer holds zero API keys for inference.

The only keys the developer holds: `GEMINI_API_KEY` — and even this should eventually migrate to `puter.ai.chat('gemini-...')` if Puter exposes Gemini models.

### Constraint 2 — Puter Worker Invocation
**WRONG:** `fetch('/api/pipeline/fetch', { method: 'POST' })` — Next.js API routes do not exist as server endpoints on Puter static hosting.
**ALSO WRONG:** `puter.workers.run()` — this method does not exist in the current Puter SDK and will throw a silent runtime error.
**RIGHT:** Use `puter.workers.execute('worker-name', payload)` — this is the correct SDK method name. Verify against the live Puter SDK docs before building; use `puter.workers.exec()` as the fallback alias if `execute()` is unavailable.

Worker registration pattern:
```javascript
// In puter-worker/fetcher.js — registered as 'sentiment-fetcher'
puter.workers.register('sentiment-fetcher', async (payload) => {
  const { cycleId, groupIndex, feeds } = payload;
  await runFetcher(cycleId, groupIndex, feeds);
});

// Invocation from Manager — CORRECT method name:
await puter.workers.execute('sentiment-fetcher', { cycleId, groupIndex, feeds: group });
// Alias fallback if execute() unavailable:
// await puter.workers.exec('sentiment-fetcher', { cycleId, groupIndex, feeds: group });
```

### Constraint 3 — KV Key Ordering for Semantic Cache
**WRONG:** `semhash:{timestamp_ms}:{hash}` with `.sort()` descending — `puter.kv.list()` lists lexicographically. Sorting client-side after fetching all keys is expensive and the `reverse: true` flag is not guaranteed to exist or perform correctly in the Puter SDK.
**RIGHT:** Use a **Decreasing Timestamp** prefix: `MAX_SAFE_INT - current_timestamp_ms`. Because `Number.MAX_SAFE_INT - recentTs` produces a *smaller* number than `MAX_SAFE_INT - oldTs`, recent entries naturally sort to the **top** of a standard ascending lexicographic `kv.list()` with zero post-processing.

```typescript
const MAX_TS = Number.MAX_SAFE_INT; // 9007199254740991
const decreasingTs = MAX_TS - Date.now();
// Key: semhash:0000000000001234:{hash}  ← recent (small decreasing number, sorts first)
// Key: semhash:0000000000891234:{hash}  ← old   (larger decreasing number, sorts later)
const key = `semhash:${String(decreasingTs).padStart(16, '0')}:${embHash}`;
```

`kv.list('semhash:')` now returns the most recent entries first by default — just `.slice(0, 200)` with no sorting needed.

### Constraint 4 — EWMA Race Condition (Atomic Lock via `puter.kv.incr()`)
**WRONG:** Read KV → compute EWMA → write KV (no guard). Two parallel workers processing AAPL news simultaneously will both read the same `prev` state and one update will silently overwrite the other.
**ALSO WRONG:** `get` then `set` pattern for locking — two workers can both `get` a null value simultaneously and both `set` it, completely defeating the lock.
**RIGHT:** Use `puter.kv.incr('lock:{ticker}')` as an **atomic semaphore**. `incr()` is a single atomic operation — it cannot be split between two workers. If the return value is `1`, this worker owns the lock. If `> 1`, back off and retry. See Section 7.3 for full implementation.

### Constraint 5 — Circuit Breaker Before Backoff
**WRONG:** Retrying a source that has failed 10 times in a row wastes resources and risks IP ban.
**RIGHT:** Track per-source failure counts in KV. After 5 consecutive failures, trip the circuit breaker for 15 minutes. See Section 7 for full implementation.

---

## 3. COMPLETE SYSTEM ARCHITECTURE

### 3.1 Worker Fan-Out (Puter Native Workers)

```
[MANAGER WORKER — 'sentiment-manager']
  Triggered by: puter.workers.execute() from frontend prewarm OR self-scheduling via KV
         │
         │  puter.workers.execute('sentiment-fetcher', { group }) × 10
         ▼
[10x FETCHER WORKERS — 'sentiment-fetcher']
  Each fetches ~10 RSS/JSON feeds
  Writes raw articles → puter.kv "queue:raw:{cycleId}:{groupIndex}"
  Increments puter.kv "manager:cycle:{cycleId}:done"
         │
         │  puter.workers.execute('sentiment-pipeline')
         ▼
[PIPELINE WORKER — 'sentiment-pipeline']
  Polls KV until done === expected
  Runs Stage 0 → Stage 5 for each article
         │
         ▼
[puter.kv — Live SL Index, history snapshots, stats]
         │
         ▼
[Next.js Frontend — SWR + Optimistic UI]
```

### 3.2 Full Pipeline Data Flow (Sequential)

```
Raw article arrives
    │
    ▼
[STAGE 0 — Dual Deduplication]
  Pass 1: SHA256 exact hash  (free, instant)
  Pass 2: puter.ai.embed() cosine similarity  (semantic near-dupe check)
    │ (MISS only)
    ▼
[STAGE 1 — Relevance Pre-Filter]
  puter.ai.chat('gemini-2.0-flash') batched 16/call
  Gemini Context Cache on system prompt prefix
    │ (RELEVANT only)
    ▼
[STAGE 2a — NER → Ticker Extraction]
  puter.ai.chat('gemini-2.5-pro') with surrounding_context field
    │
    ▼
[STAGE 2b — Contextual Disambiguation]
  Keyword co-occurrence validation — prevents "Apple" → AAPL (fruit article)
    │ (validated tickers only)
    ▼
[STAGE 3 — Per-Ticker Sentiment Scoring]
  puter.ai.chat('claude-sonnet-4-5') → deepseek fallback
    │
    ▼
[STAGE 4 — EWMA Aggregation]
  Acquire distributed lock per ticker
  Read → compute → write
  Release lock
    │
    ▼
[STAGE 5 — Hourly Snapshot + Circuit Breaker Metrics Update]
```

---

## 4. FILE STRUCTURE

```
/
├── app/
│   ├── layout.tsx
│   ├── page.tsx                           # Dashboard — SWR + Optimistic UI
│   └── ticker/[symbol]/page.tsx           # Ticker deep dive — SWR + shadow updates
├── lib/
│   ├── pipeline/
│   │   ├── index.ts                       # Pipeline orchestrator
│   │   ├── stage0-dedup.ts               # SHA256 + puter.ai.embed() semantic dedup
│   │   ├── stage1-prefilter.ts           # Batched relevance filter + context cache
│   │   ├── stage2a-ner.ts                # NER + ticker extraction
│   │   ├── stage2b-disambiguate.ts       # Contextual disambiguation
│   │   ├── stage3-sentiment.ts           # Per-ticker sentiment scoring
│   │   ├── stage4-aggregation.ts         # EWMA + distributed locking
│   │   └── stage5-snapshot.ts            # Hourly KV snapshots
│   ├── workers/
│   │   ├── manager.ts                    # Fan-out coordinator
│   │   ├── fetcher.ts                    # Feed group fetcher
│   │   └── prewarm.ts                    # Cold-start bootstrap
│   ├── resilience/
│   │   ├── backoff.ts                    # Exponential backoff with jitter
│   │   ├── circuit-breaker.ts            # Per-source circuit breaker
│   │   └── lock.ts                       # Distributed KV lock
│   ├── feeds/
│   │   ├── index.ts
│   │   ├── rss-parser.ts
│   │   ├── json-parser.ts
│   │   └── sources.ts
│   ├── cache/
│   │   └── kv.ts                         # puter.kv wrapper + manual TTL
│   ├── models/
│   │   ├── puter-ai.ts                   # puter.ai wrapper (chat + embed)
│   │   └── fallback-chain.ts             # Model fallback orchestration
│   ├── validators/
│   │   ├── ticker.ts
│   │   └── index.ts
│   └── types/
│       └── index.ts
├── components/
│   ├── Dashboard/
│   │   ├── SentimentOverview.tsx
│   │   ├── TopMovers.tsx
│   │   ├── SentimentGauge.tsx
│   │   ├── MarketRegimeBadge.tsx
│   │   └── LastUpdatedTimer.tsx          # "Last updated: 3s ago" live counter
│   ├── Charts/
│   │   ├── SentimentTimeline.tsx
│   │   ├── VolatilityBar.tsx
│   │   └── MomentumIndicator.tsx
│   └── Ticker/
│       ├── TickerHeader.tsx
│       ├── RecentSignals.tsx
│       └── SignalCard.tsx
├── hooks/
│   ├── useSentimentOverview.ts           # SWR + optimistic updates
│   ├── useTickerData.ts                  # SWR + shadow momentum projection
│   └── useLastUpdated.ts                # Live "X seconds ago" timer hook
└── puter-worker/
    ├── manager.js                        # 'sentiment-manager' worker
    ├── fetcher.js                        # 'sentiment-fetcher' worker
    └── pipeline.js                       # 'sentiment-pipeline' worker
```

---

## 5. DATA SCHEMAS (`lib/types/index.ts`)

```typescript
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

export interface SentimentScore {
  ticker: string;
  sentiment_score: number;
  confidence: number;
  signal_type: 'EARNINGS' | 'ANALYST' | 'REGULATORY' | 'MA' | 'MACRO' |
               'GEOPOLITICAL' | 'SUPPLY_CHAIN' | 'MANAGEMENT' | 'PRODUCT' | 'LEGAL' | 'OTHER';
  time_horizon: 'INTRADAY' | 'SHORT_TERM' | 'MEDIUM_TERM' | 'LONG_TERM';
  reasoning_tag: string;
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
```

---

## 6. PUTER.KV CACHE LAYER (`lib/cache/kv.ts`)

`puter.kv` has no native TTL. Implement manually. All KV interactions go through this wrapper.

```typescript
interface KVEntry<T> {
  value: T;
  expiresAt: number | null;
  schema_version: '1.3';
}

export async function kvSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
  const entry: KVEntry<T> = {
    value,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    schema_version: '1.3',
  };
  await puter.kv.set(key, JSON.stringify(entry));
}

export async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const raw = await puter.kv.get(key);
    if (!raw) return null;
    const entry: KVEntry<T> = JSON.parse(raw);
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      await puter.kv.del(key);
      return null;
    }
    return entry.value;
  } catch {
    return null;
  }
}

export async function kvDel(key: string): Promise<void> {
  await puter.kv.del(key);
}

export async function kvIncrement(key: string, ttlSeconds?: number): Promise<number> {
  const current = await kvGet<number>(key) ?? 0;
  const next = current + 1;
  await kvSet(key, next, ttlSeconds);
  return next;
}

// List keys with a prefix, returned in raw KV order
export async function kvListPrefix(prefix: string): Promise<string[]> {
  return await puter.kv.list(prefix);
}
```

**KV Key Registry:**

| Key Pattern | TTL | Purpose |
|---|---|---|
| `hash:{sha256}` | 48hr | Exact dedup flag |
| `semhash:{decreasing_ts}:{hash}` | 48hr | Semantic dedup — decreasing ts prefix ensures kv.list() returns newest first |
| `relevance:{article_id}` | 24hr | Pre-filter result |
| `ner:{article_id}` | 24hr | NER result |
| `sentiment:{article_id}` | 24hr | Sentiment result |
| `sl:{ticker}` | none | Live SL index |
| `sl:history:{ticker}:{YYYYMMDD_HH}` | 72hr | Hourly snapshot |
| `feed:meta:{sourceHash}` | 1hr | Last polled timestamp |
| `watchlist:global` | 24hr | Active ticker list |
| `dlq:{article_id}` | 7 days | Failed articles |
| `stats:24h` | 1hr | Pipeline metrics |
| `poller:last_run` | none | Scheduling guard |
| `prewarm:last` | 5min | Anti-storm guard |
| `queue:raw:{cycleId}:{n}` | 10min | Fetcher output queue |
| `manager:cycle:{cycleId}:expected` | 10min | Fan-out total count |
| `manager:cycle:{cycleId}:done` | 10min | Fan-out completion counter |
| `cb:{sourceHash}` | none | Circuit breaker state per source |
| `lock:{ticker}` | 5s | Atomic incr() semaphore counter |
| `lock:meta:{ticker}` | 5s | Lock TTL metadata (stale lock detection) |

---

## 7. RESILIENCE LAYER (`lib/resilience/`)

### 7.1 Exponential Backoff with Jitter (`lib/resilience/backoff.ts`)

```typescript
interface BackoffOptions {
  maxRetries?: number;      // default: 5
  baseDelayMs?: number;     // default: 1000
  maxDelayMs?: number;      // default: 60000
  jitterFactor?: number;    // default: 0.3
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {}
): Promise<T> {
  const { maxRetries = 5, baseDelayMs = 1000, maxDelayMs = 60_000, jitterFactor = 0.3 } = options;
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      // Check for rate-limit signal
      const isRateLimit = err?.status === 429 || err?.status === 503;
      if (!isRateLimit && attempt === 0) throw err; // fast-fail non-transient errors

      if (attempt < maxRetries) {
        const exponential = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
        const jitter = exponential * jitterFactor * Math.random();
        await sleep(Math.floor(exponential + jitter));
      }
    }
  }
  throw lastError!;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
```

### 7.2 Circuit Breaker (`lib/resilience/circuit-breaker.ts`)

Prevents hammering failing sources. After 5 consecutive failures, the breaker trips for 15 minutes. This protects against IP bans and wasted compute.

```typescript
const FAILURE_THRESHOLD = 5;
const TRIP_DURATION_MS = 15 * 60 * 1000; // 15 minutes

export async function isCircuitOpen(sourceUrl: string): Promise<boolean> {
  const key = `cb:${hashUrl(sourceUrl)}`;
  const state = await kvGet<CircuitBreakerState>(key);
  if (!state || !state.tripped) return false; // circuit closed = allow through

  // Check if trip duration has elapsed
  const retryAfter = new Date(state.retry_after!).getTime();
  if (Date.now() > retryAfter) {
    // Auto-reset: half-open state — allow one probe through
    await kvSet(key, { ...state, tripped: false, consecutive_failures: 0, tripped_at: null, retry_after: null });
    return false;
  }

  return true; // still tripped — block the request
}

export async function recordSuccess(sourceUrl: string): Promise<void> {
  const key = `cb:${hashUrl(sourceUrl)}`;
  await kvSet<CircuitBreakerState>(key, {
    source_url: sourceUrl,
    consecutive_failures: 0,
    tripped: false,
    tripped_at: null,
    retry_after: null,
    schema_version: '1.3',
  });
}

export async function recordFailure(sourceUrl: string): Promise<void> {
  const key = `cb:${hashUrl(sourceUrl)}`;
  const state = await kvGet<CircuitBreakerState>(key) ?? {
    source_url: sourceUrl,
    consecutive_failures: 0,
    tripped: false,
    tripped_at: null,
    retry_after: null,
    schema_version: '1.3' as const,
  };

  const failures = state.consecutive_failures + 1;
  const shouldTrip = failures >= FAILURE_THRESHOLD;
  const now = new Date().toISOString();

  await kvSet<CircuitBreakerState>(key, {
    ...state,
    consecutive_failures: failures,
    tripped: shouldTrip,
    tripped_at: shouldTrip ? now : state.tripped_at,
    retry_after: shouldTrip
      ? new Date(Date.now() + TRIP_DURATION_MS).toISOString()
      : null,
    schema_version: '1.3',
  });

  if (shouldTrip) {
    console.warn(`[CircuitBreaker] TRIPPED: ${sourceUrl} after ${failures} failures. Retry after 15min.`);
  }
}

function hashUrl(url: string): string {
  // Simple stable hash for use as KV key suffix
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}
```

**Usage in Fetcher:**
```typescript
// lib/workers/fetcher.ts
for (const feed of feeds) {
  if (await isCircuitOpen(feed.url)) {
    console.log(`[Fetcher] Circuit open, skipping: ${feed.url}`);
    continue;  // skip — don't even attempt
  }

  try {
    const raw = await withBackoff(() => fetchFeed(feed.url));
    await recordSuccess(feed.url);
    articles.push(...parseFeed(raw, feed));
  } catch (e) {
    await recordFailure(feed.url);
    console.error(`[Fetcher] Failed: ${feed.url}`, e);
  }
}
```

### 7.3 Atomic Lock via `puter.kv.incr()` (`lib/resilience/lock.ts`)

**Why `get`→`set` is broken:** Two workers can both `get` a null value in the same millisecond and both proceed to `set` it — the classic TOCTOU race. The v1.3.0 approach had this flaw.

**Why `puter.kv.incr()` is correct:** `incr()` is a single atomic server-side operation. There is no window between read and write — it cannot be split. If the return value is `1`, you are the first and only worker to have claimed this lock. Any value `> 1` means another worker got there first.

```typescript
// lib/resilience/lock.ts

const LOCK_TTL_SECONDS = 5;        // auto-expires — prevents deadlock on worker crash
const LOCK_RETRY_INTERVAL_MS = 75;
const LOCK_MAX_WAIT_MS = 2000;

export async function acquireLock(ticker: string): Promise<boolean> {
  const key = `lock:${ticker}`;
  const deadline = Date.now() + LOCK_MAX_WAIT_MS;

  while (Date.now() < deadline) {
    // ATOMIC: incr() is a single server-side operation — no TOCTOU race possible
    const count = await puter.kv.incr(key);

    if (count === 1) {
      // We are the sole owner — set TTL to prevent deadlock if worker crashes
      // Use kvSet to wrap with our manual TTL (puter.kv has no native TTL on incr)
      await kvSet(`lock:meta:${ticker}`, { acquired_at: Date.now() }, LOCK_TTL_SECONDS);
      return true; // lock acquired
    }

    // count > 1 — another worker holds the lock.
    // Decrement back to avoid permanently inflating the counter.
    await puter.kv.decr(key);

    // Check if the lock is stale (holder crashed without releasing)
    const meta = await kvGet<{ acquired_at: number }>(`lock:meta:${ticker}`);
    if (!meta) {
      // Meta expired → TTL elapsed → lock is stale, delete and retry immediately
      await puter.kv.del(key);
      continue;
    }

    // Lock is legitimately held — wait with jitter and retry
    await sleep(LOCK_RETRY_INTERVAL_MS + Math.random() * 50);
  }

  return false; // timeout
}

export async function releaseLock(ticker: string): Promise<void> {
  // Delete both the counter and the meta key
  await puter.kv.del(`lock:${ticker}`);
  await puter.kv.del(`lock:meta:${ticker}`);
}

export async function withLock<T>(
  ticker: string,
  fn: () => Promise<T>
): Promise<T> {
  const acquired = await acquireLock(ticker);
  if (!acquired) {
    throw new Error(`[Lock] Could not acquire lock for ${ticker} within ${LOCK_MAX_WAIT_MS}ms`);
  }
  try {
    return await fn();
  } finally {
    await releaseLock(ticker); // always release, even on error
  }
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
```

**Lock flow summary:**
```
Worker A calls incr('lock:AAPL') → returns 1 → OWNS lock → proceeds
Worker B calls incr('lock:AAPL') → returns 2 → DOES NOT own → decrements back → retries
Worker A completes → calls del('lock:AAPL') → counter gone
Worker B calls incr('lock:AAPL') → returns 1 → OWNS lock → proceeds
```

---

## 8. PUTER.AI MODEL WRAPPER (`lib/models/puter-ai.ts`)

All AI inference and embedding goes through `puter.ai` — NOT direct API calls with developer-held keys. This is the zero-cost contract.

```typescript
// lib/models/puter-ai.ts
// ALL calls use puter.ai — billed to the authenticated user's Puter account
// The developer holds ZERO AI API keys for inference

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
  // puter.ai.embed() — zero additional cost, user-pays model
  return await withBackoff(async () => {
    const result = await puter.ai.embed(text.slice(0, 500)); // headline only
    return result.embedding;
  });
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Model routing constants — use puter.ai model identifiers
export const MODELS = {
  PREFILTER:   'gemini-2.0-flash',
  NER:         'gemini-2.5-pro',
  SENTIMENT:   'claude-sonnet-4-5',
  SENTIMENT_FALLBACK: 'deepseek-chat',
  NER_FALLBACK: 'gpt-4o-mini',
} as const;
```

---

## 9. STAGE 0 — SEMANTIC DEDUPLICATION (`lib/pipeline/stage0-dedup.ts`)

Two-pass dedup. Pass 2 uses `puter.ai.embed()` with **decreasing timestamp** prefix keys so `kv.list()` returns most-recent entries first without any sorting.

```typescript
import crypto from 'crypto';
import { puterEmbed, cosineSimilarity } from '../models/puter-ai';
import { kvGet, kvSet, kvListPrefix } from '../cache/kv';

const SEMANTIC_THRESHOLD = 0.92;
const SEMANTIC_WINDOW = 200;
const MAX_TS = Number.MAX_SAFE_INT; // 9007199254740991

export async function deduplicate(article: InputArticle): Promise<'EXACT_HIT' | 'SEMANTIC_HIT' | 'MISS'> {

  // PASS 1 — Exact SHA256 (free, instant)
  const exactHash = crypto.createHash('sha256')
    .update(article.headline + article.published_at)
    .digest('hex');

  if (await kvGet<string>(`hash:${exactHash}`)) return 'EXACT_HIT';
  await kvSet(`hash:${exactHash}`, '1', 172800);

  // PASS 2 — Semantic similarity (high-volume categories only)
  if (['markets', 'macro'].includes(article.source_category)) {
    const embedding = await puterEmbed(article.headline);

    // FIXED: Decreasing timestamp prefix — recent entries sort FIRST in kv.list()
    // MAX_TS - now() produces smaller numbers for more recent timestamps.
    // Standard lexicographic ascending sort → newest articles at top automatically.
    // No reverse flag, no client-side sorting, no SDK dependency.
    const allKeys = await kvListPrefix('semhash:');
    // kv.list() is lexicographic ascending — with decreasing prefix, newest = first
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
    const embHash = crypto.createHash('md5')
      .update(embedding.slice(0, 8).map(v => Math.round(v * 100)).join(','))
      .digest('hex').slice(0, 12);

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
```

**Why this works:**
```
Time=1000 (old):   MAX_TS - 1000 = 9007199254739991  → padded: 9007199254739991  (sorts LATER)
Time=9000 (recent): MAX_TS - 9000 = 9007199254731991 → padded: 9007199254731991  (sorts FIRST)

kv.list('semhash:') ascending lexicographic order:
  semhash:9007199254731991:abc  ← most recent  ✓
  semhash:9007199254735991:def
  semhash:9007199254739991:ghi  ← oldest       (naturally pushed to end)
```
```

---

## 10. STAGE 1 — PRE-FILTER WITH CONTEXT CACHING (`lib/pipeline/stage1-prefilter.ts`)

Batch 16 articles per call. Use Gemini Context Caching for the static system prompt — saves ~75% tokens on the repeated prefix.

```typescript
// The system prompt is IDENTICAL for every pre-filter call.
// Cache this on the Gemini side using context caching.
// On Vertex AI: create a CachedContent object once at startup, reference its name in subsequent calls.
// On Google AI Studio: use the cachedContent parameter.

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

// Vertex AI Context Cache setup (run once at worker startup)
let cachedContextName: string | null = null;

async function getOrCreateContextCache(): Promise<string> {
  if (cachedContextName) return cachedContextName;

  // Create cached content on Vertex AI — this prefix is reused across all calls
  const response = await puterChat('gemini-2.0-flash', [
    { role: 'system', content: PREFILTER_SYSTEM_PROMPT },
    { role: 'user', content: '__CACHE_WARMUP__' }
  ]);
  // In practice, use Vertex AI CachedContent API directly:
  // const cache = await vertexai.preview.cachedContents.create({ model: 'gemini-2.0-flash', systemInstruction: PREFILTER_SYSTEM_PROMPT, ttl: '3600s' });
  // cachedContextName = cache.name;
  return 'cached'; // placeholder until Vertex AI CachedContent is wired
}

export async function batchPrefilter(
  articles: InputArticle[]
): Promise<Array<{ article_id: string; relevant: boolean }>> {

  const articlesJson = JSON.stringify(
    articles.map(a => ({ article_id: a.article_id, headline: a.headline, summary: a.summary?.slice(0, 200) }))
  );

  const prompt = `${PREFILTER_SYSTEM_PROMPT}\n\nArticles:\n${articlesJson}`;

  try {
    const raw = await puterChat(MODELS.PREFILTER, [{ role: 'user', content: prompt }], { jsonMode: true });
    const parsed = JSON.parse(raw);
    return parsed.results ?? [];
  } catch {
    // Conservative fallback: mark all as relevant — don't drop articles on classifier failure
    return articles.map(a => ({ article_id: a.article_id, relevant: true }));
  }
}
```

---

## 11. STAGE 2a — NER (`lib/pipeline/stage2a-ner.ts`)

```typescript
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
  const maxEntities = parseInt(process.env.NER_MAX_ENTITIES ?? '10');
  const prompt = NER_PROMPT(article, maxEntities);

  try {
    const raw = await puterChat(MODELS.NER, [{ role: 'user', content: prompt }], { jsonMode: true });
    const parsed = JSON.parse(raw);
    return {
      article_id: article.article_id,
      entities: (parsed.entities ?? []).filter((e: any) => !e.ticker || isValidTicker(e.ticker)),
      schema_version: SCHEMA_VERSION,
    };
  } catch {
    // Fallback to gpt-4o-mini via puter.ai
    const raw = await puterChat(MODELS.NER_FALLBACK, [{ role: 'user', content: prompt }], { jsonMode: true });
    const parsed = JSON.parse(raw);
    return {
      article_id: article.article_id,
      entities: (parsed.entities ?? []).filter((e: any) => !e.ticker || isValidTicker(e.ticker)),
      schema_version: SCHEMA_VERSION,
    };
  }
}
```

---

## 12. STAGE 2b — DISAMBIGUATION (`lib/pipeline/stage2b-disambiguate.ts`)

```typescript
const FINANCIAL_KEYWORDS = [
  'stock', 'share', 'equity', 'nasdaq', 'nyse', 'exchange', 'listed', 'ticker',
  'earnings', 'revenue', 'profit', 'loss', 'guidance', 'forecast', 'dividend',
  'buyback', 'acquisition', 'merger', 'ipo', 'analyst', 'upgrade', 'downgrade',
  'price target', 'rating', 'quarterly', 'ceo', 'cfo', 'shareholders', 'investors',
  'blockchain', 'defi', 'trading volume', 'market cap',
];

const AMBIGUOUS_TICKERS: Record<string, string> = {
  'AAPL': 'Apple', 'AMZN': 'Amazon', 'GOOGL': 'Google', 'META': 'Meta',
  'SNAP': 'Snap',  'UBER': 'Uber',   'LYFT': 'Lyft',   'PINS': 'Pinterest',
  'GOLD': 'Gold (Barrick)',           'VALE': 'Vale',
};

export function disambiguateEntities(entities: NEREntity[], articleText: string): NEREntity[] {
  const lowerText = articleText.toLowerCase();

  return entities
    .map(entity => {
      if (!entity.ticker) return { ...entity, disambiguation_passed: false, financial_context_score: 0 };

      if (!(entity.ticker in AMBIGUOUS_TICKERS)) {
        return { ...entity, disambiguation_passed: true, financial_context_score: 1.0 };
      }

      // Ambiguous — score by keyword co-occurrence in surrounding context
      const contextToCheck = (entity.surrounding_context + ' ' + lowerText).toLowerCase();
      const hits = FINANCIAL_KEYWORDS.filter(kw => contextToCheck.includes(kw)).length;
      const score = parseFloat(Math.min(hits / 3, 1.0).toFixed(2));

      return { ...entity, disambiguation_passed: score >= 0.33, financial_context_score: score };
    })
    .filter(e => e.disambiguation_passed);
}
```

---

## 13. STAGE 3 — SENTIMENT SCORING (`lib/pipeline/stage3-sentiment.ts`)

```typescript
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
  const prompt = SENTIMENT_PROMPT(article, entities);

  const tryModel = async (model: string) => {
    const raw = await puterChat(model, [{ role: 'user', content: prompt }], { jsonMode: true });
    return JSON.parse(raw);
  };

  let parsed;
  try { parsed = await tryModel(MODELS.SENTIMENT); }
  catch { parsed = await tryModel(MODELS.SENTIMENT_FALLBACK); }

  const scores: SentimentScore[] = (parsed.scores ?? []).filter((s: any) =>
    isValidTicker(s.ticker) &&
    typeof s.sentiment_score === 'number' && Math.abs(s.sentiment_score) <= 1.0 &&
    typeof s.confidence === 'number' && s.confidence >= 0 && s.confidence <= 1.0
  );

  return { article_id: article.article_id, scores, market_regime: parsed.market_regime ?? 'NEUTRAL', schema_version: SCHEMA_VERSION };
}
```

---

## 14. STAGE 4 — EWMA AGGREGATION WITH DISTRIBUTED LOCKING (`lib/pipeline/stage4-aggregation.ts`)

```typescript
import { withLock } from '../resilience/lock';
import { v4 as uuidv4 } from 'uuid';

const LAMBDA = parseFloat(process.env.EWMA_DECAY ?? '0.94');

export async function updateSentimentLiquidity(
  ticker: string,
  score: SentimentScore,
  sourceWeight: number,
  marketSession: string,
  timestamp: string
): Promise<SentimentLiquidityIndex> {

  const workerId = uuidv4(); // kept for logging/tracing — no longer needed for lock ownership

  // ATOMIC LOCK via puter.kv.incr() — prevents EWMA race condition.
  // incr() is server-side atomic: no two workers can both get count=1.
  return await withLock(ticker, async () => {

    const prev = await kvGet<SentimentLiquidityIndex>(`sl:${ticker}`) ?? {
      ticker, ewma: 0, sentiment_liquidity_score: 0, volatility: 0,
      momentum: 0, article_signal_strength: 0, n: 0,
      lastUpdated: timestamp, regime: 'NEUTRAL' as const,
      market_session: marketSession, schema_version: SCHEMA_VERSION,
    };

    const weightedScore = score.sentiment_score * score.confidence * sourceWeight;
    const ewma = LAMBDA * prev.ewma + (1 - LAMBDA) * weightedScore;

    // Correct variance: uses newly computed ewma (not prev.ewma)
    const prevVariance = prev.volatility ** 2;
    const variance = LAMBDA * prevVariance + (1 - LAMBDA) * Math.pow(weightedScore - ewma, 2);

    const updated: SentimentLiquidityIndex = {
      ticker,
      sentiment_liquidity_score: parseFloat(ewma.toFixed(4)),
      ewma: parseFloat(ewma.toFixed(4)),
      volatility: parseFloat(Math.sqrt(Math.max(0, variance)).toFixed(4)),
      momentum: prev.n === 0 ? 0 : parseFloat((ewma - prev.ewma).toFixed(4)),
      article_signal_strength: parseFloat((score.confidence * Math.abs(score.sentiment_score) * sourceWeight).toFixed(4)),
      n: prev.n + 1,
      lastUpdated: timestamp,
      regime: ewma > 0.15 ? 'RISK_ON' : ewma < -0.15 ? 'RISK_OFF' : 'NEUTRAL',
      market_session: marketSession,
      schema_version: SCHEMA_VERSION,
    };

    await kvSet(`sl:${ticker}`, updated); // no TTL — rolling
    return updated;

  }); // lock auto-released here (or on error via finally block in withLock)
}
```

---

## 15. FRONTEND — SWR + OPTIMISTIC UI (`hooks/` + `app/`)

### 15.1 SWR Hooks with Optimistic Shadow Updates

```typescript
// hooks/useSentimentOverview.ts
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function useSentimentOverview() {
  const { data, error, isLoading, isValidating, mutate } = useSWR<OverviewResponse>(
    '/api/sentiment/overview',
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      revalidateOnReconnect: true,
      keepPreviousData: true,      // show stale data immediately — no blank flash
      dedupingInterval: 10_000,
    }
  );

  return { data, isLoading, isRefreshing: isValidating && !isLoading, error, mutate };
}

// hooks/useTickerData.ts
export function useTickerData(symbol: string) {
  const { data, error, isLoading, isValidating } = useSWR<TickerResponse>(
    symbol ? `/api/sentiment/ticker/${symbol}` : null,
    fetcher,
    { refreshInterval: 30_000, keepPreviousData: true, revalidateOnFocus: true }
  );

  // SHADOW UPDATE — project the current score forward using momentum
  // Creates "Bloomberg Terminal" feel: UI updates before the API call returns
  const shadowScore = data?.current
    ? projectScoreForward(data.current)
    : null;

  return { data, shadowScore, isLoading, isRefreshing: isValidating && !isLoading, error };
}

// Shadow momentum projection — extrapolates score between refreshes
function projectScoreForward(sl: SentimentLiquidityIndex): number {
  const secondsSinceUpdate = (Date.now() - new Date(sl.lastUpdated).getTime()) / 1000;
  const decayFactor = Math.exp(-secondsSinceUpdate / 300); // 5-minute half-life

  // Project: current score + attenuated momentum
  const projected = sl.sentiment_liquidity_score + (sl.momentum * decayFactor * 0.1);

  // Clamp to valid range
  return Math.max(-1.0, Math.min(1.0, parseFloat(projected.toFixed(4))));
}
```

### 15.2 "Last Updated" Live Timer Hook

```typescript
// hooks/useLastUpdated.ts
import { useState, useEffect } from 'react';

export function useLastUpdated(lastUpdated: string | undefined) {
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    if (!lastUpdated) return;
    const interval = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - new Date(lastUpdated).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [lastUpdated]);

  if (!lastUpdated) return 'Never';
  if (secondsAgo < 10) return 'Just now';
  if (secondsAgo < 60) return `${secondsAgo}s ago`;
  if (secondsAgo < 3600) return `${Math.floor(secondsAgo / 60)}m ago`;
  return `${Math.floor(secondsAgo / 3600)}h ago`;
}
```

### 15.3 Dashboard Page (`app/page.tsx`)

```typescript
'use client';

import { useSentimentOverview } from '../hooks/useSentimentOverview';
import { useLastUpdated } from '../hooks/useLastUpdated';
import { useEffect } from 'react';

export default function Dashboard() {
  const { data, isLoading, isRefreshing } = useSentimentOverview();
  const lastUpdated = useLastUpdated(data?.timestamp);

  // Trigger pre-warm on mount — populates KV cache if cold
  useEffect(() => {
    puter.workers.execute('sentiment-manager', { prewarm: true }).catch(() => {});
  }, []);

  if (isLoading) return <DashboardSkeleton />;

  return (
    <main>
      <Header
        regime={data?.market_regime}
        articleCount={data?.total_articles_processed_24h}
        cacheHitRate={data?.cache_hit_rate}
        semanticDedupRate={data?.semantic_dedup_rate}
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}   // subtle pulsing indicator
      />
      <TopMovers movers={data?.top_movers ?? []} />
      <MarketHeatmap data={data?.top_movers ?? []} />
      <p className="disclaimer">
        Signals are experimental and not financial advice.
      </p>
    </main>
  );
}
```

### 15.4 Ticker Deep Dive (`app/ticker/[symbol]/page.tsx`)

```typescript
'use client';

import { useTickerData } from '../../hooks/useTickerData';
import { useLastUpdated } from '../../hooks/useLastUpdated';

export default function TickerPage({ params }: { params: { symbol: string } }) {
  const { data, shadowScore, isRefreshing } = useTickerData(params.symbol);
  const lastUpdated = useLastUpdated(data?.current?.lastUpdated);

  const displayScore = shadowScore ?? data?.current?.sentiment_liquidity_score ?? 0;

  return (
    <main>
      <TickerHeader
        ticker={params.symbol}
        score={displayScore}          // uses shadow score — updates every second
        isProjected={!!shadowScore}   // subtle "(projected)" label when using shadow
        lastUpdated={lastUpdated}
        isRefreshing={isRefreshing}
      />
      <SentimentTimeline history={data?.history_24h ?? []} />
      <RecentSignals signals={data?.recent_signals ?? []} />
    </main>
  );
}
```

---

## 16. PUTER WORKERS REGISTRATION (`puter-worker/`)

Workers are registered as named Puter workers, not HTTP endpoints.

```javascript
// puter-worker/manager.js — registered as 'sentiment-manager'
puter.workers.register('sentiment-manager', async (payload) => {
  const { prewarm = false } = payload ?? {};

  const POLL_INTERVAL_MS = 30_000;
  const lastRun = await kvGet('poller:last_run');
  if (!prewarm && lastRun && Date.now() - lastRun < POLL_INTERVAL_MS) return;
  await kvSet('poller:last_run', Date.now());

  const cycleId = crypto.randomUUID();
  const groups = chunkArray(FEED_SOURCES, Math.ceil(FEED_SOURCES.length / N_FETCHER_WORKERS));

  await kvSet(`manager:cycle:${cycleId}:expected`, groups.length, 600);
  await kvSet(`manager:cycle:${cycleId}:done`, 0, 600);

  // Trigger fetcher workers via puter.workers.execute() — NOT HTTP fetch, NOT .run()
  await Promise.allSettled(
    groups.map((group, i) =>
      puter.workers.execute('sentiment-fetcher', { cycleId, groupIndex: i, feeds: group })
    )
  );

  // Trigger pipeline worker
  await puter.workers.execute('sentiment-pipeline', { cycleId });
});

// puter-worker/fetcher.js — registered as 'sentiment-fetcher'
puter.workers.register('sentiment-fetcher', async ({ cycleId, groupIndex, feeds }) => {
  const articles = [];

  for (const feed of feeds) {
    if (await isCircuitOpen(feed.url)) continue;
    try {
      const raw = await withBackoff(() => fetchFeed(feed.url));
      await recordSuccess(feed.url);
      articles.push(...parseFeed(raw, feed));
    } catch (e) {
      await recordFailure(feed.url);
    }
  }

  await kvSet(`queue:raw:${cycleId}:${groupIndex}`, articles, 600);
  await kvIncrement(`manager:cycle:${cycleId}:done`, 600);
});

// puter-worker/pipeline.js — registered as 'sentiment-pipeline'
puter.workers.register('sentiment-pipeline', async ({ cycleId }) => {
  // Wait for all fetchers to complete (poll KV)
  const expected = await kvGet(`manager:cycle:${cycleId}:expected`) ?? 0;
  const deadline = Date.now() + 45_000; // 45s max wait

  while (Date.now() < deadline) {
    const done = await kvGet(`manager:cycle:${cycleId}:done`) ?? 0;
    if (done >= expected) break;
    await sleep(500);
  }

  // Collect all queued articles
  const allArticles = [];
  for (let i = 0; i < expected; i++) {
    const batch = await kvGet(`queue:raw:${cycleId}:${i}`) ?? [];
    allArticles.push(...batch);
  }

  // Run pipeline with concurrency limit
  await processConcurrently(allArticles, processArticle, CONCURRENCY_LIMIT);
});
```

---

## 17. NEWS FEED SOURCES (`lib/feeds/sources.ts`)

```typescript
export const FEED_SOURCES: FeedSource[] = [
  // TIER 1 — weight: 1.0
  { url: 'https://feeds.reuters.com/reuters/businessNews', name: 'Reuters Business', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
  { url: 'https://feeds.reuters.com/reuters/companyNews', name: 'Reuters Companies', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
  // Bloomberg has NO public RSS — do not add bloomberg.com RSS URLs.
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_realtimeheadlines', name: 'MarketWatch RT', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', name: 'CNBC Markets', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
  { url: 'https://www.ft.com/rss/home/us', name: 'FT US', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },
  { url: 'https://feeds.wsj.com/xml/rss/3_7455.xml', name: 'WSJ Markets', tier: 1, weight: 1.0, format: 'rss', category: 'markets' },

  // TIER 2 — weight: 0.75
  { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC', name: 'Yahoo Finance', tier: 2, weight: 0.75, format: 'rss', category: 'markets' },
  { url: 'https://www.benzinga.com/feed', name: 'Benzinga', tier: 2, weight: 0.75, format: 'rss', category: 'markets' },
  { url: 'https://www.investing.com/rss/news.rss', name: 'Investing.com', tier: 2, weight: 0.75, format: 'rss', category: 'markets' },
  { url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', name: 'CoinDesk', tier: 2, weight: 0.75, format: 'rss', category: 'crypto' },
  { url: 'https://cointelegraph.com/rss', name: 'CoinTelegraph', tier: 2, weight: 0.75, format: 'rss', category: 'crypto' },
  { url: 'https://www.theblock.co/rss.xml', name: 'The Block', tier: 2, weight: 0.75, format: 'rss', category: 'crypto' },
  { url: 'https://rsshub.app/ap/topics/business', name: 'AP Business', tier: 2, weight: 0.75, format: 'rss', category: 'macro' },

  // TIER 3 — weight: 0.5
  { url: 'https://www.federalreserve.gov/feeds/press_all.xml', name: 'Federal Reserve', tier: 3, weight: 0.5, format: 'rss', category: 'macro' },
  { url: 'https://www.imf.org/en/News/rss?language=eng', name: 'IMF News', tier: 3, weight: 0.5, format: 'rss', category: 'macro' },
  { url: 'https://www.bis.org/doclist/speeches.rss', name: 'BIS Speeches', tier: 3, weight: 0.5, format: 'rss', category: 'macro' },
  { url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/fda-news-releases/rss.xml', name: 'FDA Releases', tier: 3, weight: 0.5, format: 'rss', category: 'markets' },
  { url: 'https://news.ycombinator.com/rss', name: 'Hacker News', tier: 3, weight: 0.5, format: 'rss', category: 'markets' },
  // Extend to 100+ by adding: OilPrice.com, Kitco, Nikkei Asia, SCMP Business,
  // Korea Herald Business, Euronews Business, Reuters LatAm, Valor Econômico
];
```

---

## 18. OPERATIONAL PARAMETERS (`.env`)

```bash
# Developer holds NO AI API keys — all inference is user-pays via puter.ai
# The only optional key is GEMINI_API_KEY if not routing through puter.ai for Gemini

# Pipeline tuning
N_FETCHER_WORKERS=10
POLL_INTERVAL_SECONDS=30
MAX_ARTICLES_PER_CYCLE=500
CONCURRENCY_LIMIT=10
BATCH_SIZE_PREFILTER=16
NER_MAX_ENTITIES=10
EWMA_DECAY=0.94
MIN_CONFIDENCE_THRESHOLD=0.60
SEMANTIC_SIMILARITY_THRESHOLD=0.92

# Circuit breaker
CB_FAILURE_THRESHOLD=5
CB_TRIP_DURATION_MINUTES=15

# Lock
LOCK_TTL_SECONDS=5
LOCK_MAX_WAIT_MS=2000

# Models (puter.ai identifiers)
NER_MODEL_PRIMARY=gemini-2.5-pro
NER_MODEL_FALLBACK=gpt-4o-mini
SENTIMENT_MODEL_PRIMARY=claude-sonnet-4-5
SENTIMENT_MODEL_FALLBACK=deepseek-chat
RELEVANCE_MODEL=gemini-2.0-flash
```

---

## 19. SUCCESS METRICS (KPIs)

| Metric | Target | Critical Threshold |
|---|---|---|
| Cache Hit Rate (SHA256) | > 60% | < 40% → review dedup |
| Semantic Dedup Rate | > 15% | < 5% → check embed model |
| NER Validation Pass Rate | > 92% | < 80% → swap model |
| Disambiguation Pass Rate | > 85% | < 70% → expand keywords |
| Sentiment Latency p95 | < 600ms | > 2000ms → fallback |
| Pre-Filter Latency p95 | < 800ms | > 2000ms → fallback |
| Article Throughput | > 200/min | < 50/min → scale workers |
| DLQ Growth Rate | < 1% | > 5% → investigate |
| Circuit Breakers Tripped | < 5/day | > 20/day → feed audit |
| Lock Timeout Rate | < 0.1% | > 1% → reduce concurrency |
| Worker Timeout Rate | 0% | > 1% → reduce group size |
| Shadow Projection Error | < 5% drift | > 15% → tune decay |

---

## 20. IMPLEMENTATION ORDER

```
1.  lib/types/index.ts
2.  lib/cache/kv.ts
3.  lib/resilience/backoff.ts
4.  lib/resilience/circuit-breaker.ts
5.  lib/resilience/lock.ts
6.  lib/models/puter-ai.ts                  ← all AI calls go here, no raw API keys
7.  lib/validators/ticker.ts
8.  lib/feeds/rss-parser.ts + json-parser.ts + sources.ts
9.  lib/feeds/index.ts                      ← uses circuit-breaker + backoff
10. lib/pipeline/stage0-dedup.ts            ← puter.ai.embed()
11. lib/pipeline/stage1-prefilter.ts        ← context caching setup
12. lib/pipeline/stage2a-ner.ts
13. lib/pipeline/stage2b-disambiguate.ts
14. lib/pipeline/stage3-sentiment.ts
15. lib/pipeline/stage4-aggregation.ts      ← withLock()
16. lib/pipeline/stage5-snapshot.ts
17. lib/pipeline/index.ts
18. lib/workers/manager.ts + fetcher.ts + prewarm.ts
19. puter-worker/manager.js                 ← puter.workers.register()
20. puter-worker/fetcher.js
21. puter-worker/pipeline.js
22. hooks/useLastUpdated.ts
23. hooks/useSentimentOverview.ts
24. hooks/useTickerData.ts                  ← shadow projection
25. components/ (all)
26. app/page.tsx                            ← puter.workers.execute() for prewarm
27. app/ticker/[symbol]/page.tsx            ← shadow score display
```

---

## 21. SECURITY & COMPLIANCE

- **True zero-cost:** `puter.ai` for all inference — developer holds zero AI API keys. User-pays model is non-negotiable.
- **No PII stored:** hashed IDs and headlines only.
- **No trading directives:** display *"Signals are experimental. Not financial advice."* on every page.
- **Circuit breakers:** protect third-party feed providers from excessive retries.
- **Atomic locks:** `puter.kv.incr()` semaphore prevents EWMA race conditions — no TOCTOU window possible.
- **Schema versioning:** `schema_version: "1.3"` on all KV objects.
- **Lock auto-expiry:** 5-second TTL on all locks prevents deadlocks under worker failure.

---

*SentimentCore Master Prompt — v1.4.0*
*Changelog from v1.3.0:*
*FIXED: Atomic lock rewritten — replaced get→set TOCTOU race with puter.kv.incr() semaphore. count===1 = lock owned, count>1 = back off + decrement. Deadlock prevention via 5s TTL on lock:meta key.*
*FIXED: puter.workers.run() → puter.workers.execute() throughout — correct SDK method name. exec() noted as fallback alias.*
*FIXED: Semantic cache key prefix changed from ascending timestamp to decreasing timestamp (MAX_SAFE_INT - Date.now(), padded to 16 digits). kv.list() lexicographic ascending now returns newest entries first with zero post-processing.*
*REMOVED: workerId parameter from withLock() — no longer needed since ownership is tracked atomically via incr() counter, not by worker identity.*
