// gen_call guard — Studionet limit: 60 req/min (1000/hr).
// Inspired by ParaNusa (read-only client + slow consensus polling), plus:
//  - min-gap queue: every RPC (read/write/getTransaction) serialized ≥ minGapMs
//    apart → sustained rate stays under the per-minute quota.
//  - TTL cache + in-flight dedup: identical concurrent/near-concurrent reads
//    (StrictMode double-mount, multi-component, page remount) share ONE call.
//  - exponential backoff on rate-limit-shaped errors (429 / "rate limit" / ...).
// Errors are never swallowed — only retried when they look like throttling.

export const rpcConfig = {
  minGapMs: 1050, // ≈57 calls/min < 60/min quota
  backoffBaseMs: 1500,
  backoffMaxRetry: 3,
};

const RATE_LIMIT_RE =
  /\b429\b|rate.?limit|too many requests|quota|limit exceeded|status code 429/i;

export function isRateLimitError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return RATE_LIMIT_RE.test(m);
}

// ---- serialized min-gap queue (FIFO by reservation time) ----
let nextSlot = 0;

function reserveSlot(): Promise<void> {
  const start = Math.max(Date.now(), nextSlot);
  nextSlot = start + rpcConfig.minGapMs;
  const wait = start - Date.now();
  return wait <= 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, wait));
}

/** Gate a raw RPC with the min-gap queue + rate-limit backoff. No caching. */
export async function rpcGate<T>(fn: () => Promise<T>): Promise<T> {
  let attempt = 0;
  for (;;) {
    await reserveSlot();
    try {
      return await fn();
    } catch (e) {
      if (attempt < rpcConfig.backoffMaxRetry && isRateLimitError(e)) {
        await new Promise((r) =>
          setTimeout(r, rpcConfig.backoffBaseMs * 2 ** attempt + Math.floor(Math.random() * 400))
        );
        attempt++;
        continue;
      }
      throw e;
    }
  }
}

// ---- TTL value cache + in-flight dedup ----
const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { exp: number; v: unknown }>();
const MAX_CACHE_KEYS = 128;

function pruneCache(now: number) {
  if (cache.size <= MAX_CACHE_KEYS) return;
  for (const [k, e] of cache) if (e.exp <= now) cache.delete(k);
  // still over? drop oldest-inserted (Map order) beyond cap
  for (const k of cache.keys()) {
    if (cache.size <= MAX_CACHE_KEYS) break;
    cache.delete(k);
  }
}

/**
 * Read through the guard: cached for `ttlMs`, concurrent callers share the
 * in-flight promise, the underlying call is gated + backoff-retried.
 * ttlMs <= 0 → no value caching (still dedups concurrent calls).
 * Failures are never cached.
 */
export function rpcRead<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return Promise.resolve(hit.v as T);
  const flight = inFlight.get(key);
  if (flight) return flight as Promise<T>;
  const p = rpcGate(fn)
    .then((v) => {
      if (ttlMs > 0) {
        cache.set(key, { exp: Date.now() + ttlMs, v });
        pruneCache(Date.now());
      }
      return v;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/** Drop cached reads — call after any state-changing write. */
export function rpcClear(): void {
  cache.clear();
}
