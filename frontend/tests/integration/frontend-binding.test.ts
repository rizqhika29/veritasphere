// Contract ↔ frontend integration tests (real studionet).
// Runs the EXACT functions pages use from lib/genlayer.ts against the live
// contract: reads (typed shape for the UI), writes (submit happy-path +
// rejected-path through writeWithWallet), and schema parity so frontend
// function names can never drift from the contract.
//
// Run: npm run test:integration
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { createClient } from "genlayer-js";

type GL = typeof import("../../lib/genlayer");
type ValidationResult = import("../../lib/genlayer").ValidationResult;
let gl: GL;

// Every contract function the frontend calls (lib/genlayer.ts) — parity check.
const FRONTEND_FNS = [
  "get_stats", "get_all_entries", "get_pending_entries", "get_topics",
  "get_leaderboard", "get_validation_result", "get_entry", "get_accepted_entries",
  "submit_contribution", "validate_contribution", "cancel_pending",
];

before(async () => {
  // Load frontend/.env BEFORE importing lib/genlayer (module reads env at load).
  const envPath = resolve(process.cwd(), ".env");
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
  gl = await import("../../lib/genlayer");
  assert.ok(gl.isConfigured(), "isConfigured() must be true — check frontend/.env");
});

test("readStats: typed shapes for UI (number/string, no bigint)", { timeout: 60_000 }, async () => {
  const s = await gl.readStats();
  assert.equal(s.name, "Veritasphere");
  assert.equal(typeof s.total_entries, "number");
  assert.equal(typeof s.reward_amount, "string");
  assert.ok(Array.isArray(s.topics));
  assert.ok(s.total_entries >= 1, "studionet suite already created entries");
});

test("readAll: {total, entries[]} with entry cards the explore page renders", { timeout: 60_000 }, async () => {
  const { total, entries } = await gl.readAll(1, 50);
  assert.equal(typeof total, "number");
  assert.ok(Array.isArray(entries) && entries.length >= 1);
  for (const e of entries) {
    assert.equal(typeof e.id, "number");
    assert.equal(typeof e.topic, "string");
    assert.equal(typeof e.title, "string");
    assert.equal(typeof e.status, "string");
    assert.equal(typeof e.score, "number");
    assert.ok(["PENDING", "ACCEPTED", "REJECTED", "CANCELLED"].includes(e.status));
  }
});

test("readTopics / readPending / readLeaderboard: page shapes", { timeout: 60_000 }, async () => {
  const topics = await gl.readTopics();
  assert.ok(topics.every((t) => typeof t === "string"));

  const pending = await gl.readPending();
  for (const p of pending) {
    assert.equal(typeof p.id, "number");
    assert.equal(typeof p.source_url, "string");
    assert.match(p.contributor, /^0x[0-9a-fA-F]{40}$/);
  }

  const lb = await gl.readLeaderboard(10);
  assert.ok(lb.length >= 1);
  for (const r of lb) {
    assert.equal(typeof r.submitted, "number");
    assert.equal(typeof r.accepted, "number");
    assert.match(r.contributor, /^0x[0-9a-fA-F]{40}$/);
  }
});

test("readValidationResult / readEntry: entry detail page fields", { timeout: 60_000 }, async () => {
  const v = await gl.readValidationResult(1); // ACCEPTED by the studionet suite
  assert.equal(v.id, 1);
  assert.equal(v.status, "ACCEPTED");
  assert.equal(v.accepted, true);
  assert.equal(typeof v.ai_score, "number");
  assert.equal(v.threshold, 7);
  assert.equal(typeof v.settled_reward, "string");
  assert.ok(v.ai_summary.length > 0);
  assert.match(v.source_url, /^https:\/\//);

  const e = await gl.readEntry(1);
  assert.ok(e && typeof e === "object");
  assert.match(String((e as { contributor: string }).contributor), /^0x[0-9a-fA-F]{40}$/);
});

test("readAccepted: accepted list + topic case-insensitive", { timeout: 60_000 }, async () => {
  const all = await gl.readAccepted("", 10);
  assert.ok(all.length >= 1);
  const byTopic = await gl.readAccepted("CRYPTO", 10);
  assert.equal(byTopic.length, all.length);
});

test("dec(): bigint → JS primitives everywhere (unit)", () => {
  assert.equal(gl.dec(5n), 5);
  assert.equal(gl.dec({ a: [1n, "x"], b: { c: 7n } }).b.c, 7);
  assert.equal(gl.dec("keep"), "keep");
  assert.equal(gl.dec(null), null);
});

test("schema parity: every frontend function exists on the deployed contract", { timeout: 60_000 }, async () => {
  const client = createClient({ chain: studionet, endpoint: process.env.NEXT_PUBLIC_RPC_URL });
  const schema = await client.getContractSchema(
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`
  );
  const dump = JSON.stringify(schema);
  const missing = FRONTEND_FNS.filter((fn) => !dump.includes(fn));
  assert.deepEqual(missing, [], `frontend calls missing on contract: ${missing.join(", ")}`);
});

// unique per run so the suite is re-runnable (contract rejects duplicate URLs)
const smartUrl = `https://en.wikipedia.org/wiki/Smart_contract?run=${Date.now()}`;

test("write path: submit via writeWithWallet → entry id from counter, PENDING", { timeout: 300_000 }, async () => {
  const signer = createAccount(); // local signer — same code path, no popup
  const url = smartUrl;
  const beforeStats = await gl.readStats();
  const nextId = beforeStats.total_entries + 1;

  const r = await gl.submitContributionLive(
    signer, signer.address, "crypto", "What is a smart contract?", url,
    "A smart contract is a computer program stored on a blockchain that runs automatically when predetermined conditions are met."
  );
  assert.equal(r.ok, true, `submit must execute cleanly, got: ${r.status}`);
  assert.match(r.txId, /^0x[0-9a-f]{64}$/);

  // Wait for the counter via get_stats FIRST — it never raises, unlike
  // get_validation_result(id) before the entry is indexed (that expected
  // failure makes genlayer-js spam "GenLayer RPC error (gen_call)" to stderr).
  let ready = false;
  for (let i = 0; i < 30 && !ready; i++) {
    ready = (await gl.readStats()).total_entries >= nextId;
    if (!ready) await new Promise((r2) => setTimeout(r2, 3000));
  }
  assert.ok(ready, `counter must reach ${nextId}`);

  let vr: ValidationResult | null = null;
  for (let i = 0; i < 5 && !vr; i++) {
    try {
      const v = await gl.readValidationResult(nextId);
      if (v && v.source_url === url) vr = v;
    } catch { /* LATEST_FINAL lag — rare after counter visible */ }
    if (!vr) await new Promise((r2) => setTimeout(r2, 3000));
  }
  assert.ok(vr, `entry #${nextId} must become readable`);
  assert.equal(vr!.status, "PENDING");
  assert.equal(vr!.accepted, false);
  assert.equal(vr!.contributor, signer.address);
  assert.equal(String(vr!.settled_reward), "0");
});

test("write path: duplicate source_url rejected → ok=false (frontend error contract)", { timeout: 300_000 }, async () => {
  const signer = createAccount();
  const r = await gl.submitContributionLive(
    signer, signer.address, "crypto", "Dup", smartUrl,
    "Another perfectly valid long enough summary text for the duplicate test."
  );
  assert.equal(r.ok, false, "duplicate URL must fail execution");
  assert.ok(/ERROR/.test(r.status), r.status);
});
