// Unit tests for lib/rpc.ts — the gen_call guard (no chain access, runs fast).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rpcRead, rpcGate, rpcClear, rpcConfig, isRateLimitError } from "../../lib/rpc";

const defaults = { ...rpcConfig };
afterEach(() => {
  Object.assign(rpcConfig, defaults);
  rpcClear();
});

test("in-flight dedup: concurrent identical reads share one RPC", async () => {
  rpcConfig.minGapMs = 1;
  let calls = 0;
  const fn = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 30));
    return "v";
  };
  const [a, b, c] = await Promise.all([
    rpcRead("k1", 5000, fn),
    rpcRead("k1", 5000, fn),
    rpcRead("k1", 5000, fn),
  ]);
  assert.equal(calls, 1);
  assert.deepEqual([a, b, c], ["v", "v", "v"]);
});

test("TTL cache: hit inside ttl, refetch after expiry", async () => {
  rpcConfig.minGapMs = 1;
  let calls = 0;
  const fn = async () => ++calls;
  assert.equal(await rpcRead("k2", 60, fn), 1);
  assert.equal(await rpcRead("k2", 60, fn), 1); // cached
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(await rpcRead("k2", 60, fn), 2); // expired → refetch
});

test("rate-limit shaped errors are retried with backoff", async () => {
  rpcConfig.minGapMs = 1;
  rpcConfig.backoffBaseMs = 5;
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls < 3) throw new Error("429 Too Many Requests");
    return "ok";
  };
  assert.equal(await rpcRead("k3", 0, fn), "ok");
  assert.equal(calls, 3);
});

test("non-rate-limit errors propagate immediately and are not cached", async () => {
  rpcConfig.minGapMs = 1;
  let calls = 0;
  const fn = async () => {
    calls++;
    throw new Error("execution failed: [EXPECTED] Entry not found");
  };
  await assert.rejects(() => rpcRead("k4", 60_000, fn), /Entry not found/);
  await assert.rejects(() => rpcRead("k4", 60_000, fn), /Entry not found/);
  assert.equal(calls, 2); // failure never served from cache
});

test("min-gap queue spaces sequential calls", async () => {
  rpcConfig.minGapMs = 60;
  const stamps: number[] = [];
  const fn = async () => stamps.push(Date.now());
  await rpcGate(fn);
  await rpcGate(fn);
  await rpcGate(fn);
  assert.equal(stamps.length, 3);
  const d1 = stamps[1] - stamps[0];
  const d2 = stamps[2] - stamps[1];
  assert.ok(d1 >= 50, `gap1 ${d1}ms < 50ms`);
  assert.ok(d2 >= 50, `gap2 ${d2}ms < 50ms`);
});

test("isRateLimitError matches common throttle shapes", () => {
  assert.ok(isRateLimitError(new Error("Request failed with status code 429")));
  assert.ok(isRateLimitError("Rate limit exceeded, retry later"));
  assert.ok(isRateLimitError(new Error("too many requests")));
  assert.ok(!isRateLimitError(new Error("gen_call: execution failed")));
});
