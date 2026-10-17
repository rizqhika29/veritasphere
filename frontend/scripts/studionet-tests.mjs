// Veritasphere studionet E2E + adversarial suite.
// Run: CONTRACT=0x... node scripts/studionet-tests.mjs  (contract defaults to
// frontend/.env.production). Reads use genlayer-js (no wallet). Writes shell
// out to the genlayer CLI (active unlocked account — npm i -g genlayer).
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const here = dirname(fileURLToPath(import.meta.url));

function resolveGenlayerCli() {
  if (process.env.GENLAYER_CLI) return process.env.GENLAYER_CLI;
  try {
    const out = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      shell: process.platform === "win32", // npm.cmd needs a shell on Windows
    });
    const p = join(out.trim(), "genlayer", "dist", "index.js");
    if (existsSync(p)) return p;
  } catch { /* fall through */ }
  console.error("genlayer CLI not found — npm i -g genlayer (or set GENLAYER_CLI).");
  process.exit(1);
}
const CLI = resolveGenlayerCli();

function resolveContract() {
  if (process.env.CONTRACT) return process.env.CONTRACT;
  try {
    const env = readFileSync(join(here, "..", ".env.production"), "utf8");
    const m = env.match(/^NEXT_PUBLIC_CONTRACT_ADDRESS=(.+)$/m);
    if (m) return m[1].trim();
  } catch { /* fall through */ }
  console.error("Set CONTRACT=0x... or frontend/.env.production with NEXT_PUBLIC_CONTRACT_ADDRESS.");
  process.exit(1);
}
const ADDR = resolveContract();
const REWARD = "100000000000000000"; // 0.1 GEN — constructor arg

const client = createClient({ chain: studionet });

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : "")); console.log(`  FAIL  ${name} ${extra}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }

function dec(v) {
  if (typeof v === "bigint") return Number(v) <= Number.MAX_SAFE_INTEGER ? Number(v) : v.toString();
  if (Array.isArray(v)) return v.map(dec);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = dec(x);
    return o;
  }
  return v;
}

async function call(fn, args = []) {
  const r = await client.readContract({ address: ADDR, functionName: fn, args });
  return dec(r);
}

function cliRaw(argv, { timeout = 900000 } = {}) {
  try {
    return execFileSync(process.execPath, [CLI, ...argv],
      { encoding: "utf8", maxBuffer: 100 * 1024 * 1024, timeout });
  } catch (e) {
    return (e.stdout ?? "") + (e.stderr ?? "") + `\n[CLI-EXIT ${e.status}]`;
  }
}

function cli(method, args = [], { timeout = 900000 } = {}) {
  const argv = ["write", ADDR, method];
  // commander variadic --args rejects a bare flag with zero values — omit when empty.
  // Also never pass "" (dropped by CLI arg parsing) — use " " (strip() still catches it).
  const safeArgs = args.map((a) => (a === "" ? " " : String(a)));
  if (safeArgs.length) argv.push("--args", ...safeArgs);
  return cliRaw(argv, { timeout });
}

function parseWrite(out) {
  const execRes = out.match(/execution_result: '([A-Z_]+)'/)?.[1] ?? "?";
  const resultName = out.match(/result_name: '([A-Z_]+)'/)?.[1] ?? "?";
  const statusName = out.match(/status_name: '([A-Z_]+)'/)?.[1] ?? "?";
  return { execRes, resultName, statusName, out };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function rate() { await sleep(4000); } // studionet: stay well under 60 req/min

// ---------------------------------------------------------------- E2E
section("E2E 1: initial state");
const s0 = await call("get_stats");
console.log("  get_stats:", JSON.stringify(s0));
ok("stats total_entries==0", s0.total_entries === 0, `got ${s0.total_entries}`);
ok("stats reward==1e17", String(s0.reward_amount) === REWARD, `got ${s0.reward_amount}`);
ok("name==Veritasphere", s0.name === "Veritasphere");
const emptyAll = await call("get_all_entries", [1, 10]);
ok("get_all_entries empty", emptyAll.total === 0 && emptyAll.entries.length === 0, JSON.stringify(emptyAll));
ok("get_topics empty", Array.isArray(await call("get_topics")) && (await call("get_topics")).length === 0);
ok("get_pending_entries empty", (await call("get_pending_entries")).length === 0);
ok("get_leaderboard empty", (await call("get_leaderboard", [10])).length === 0);
ok("get_accepted_entries empty", (await call("get_accepted_entries", ["", 10])).length === 0);

section("E2E 2: submit_contribution happy path (entry #1)");
await rate();
const w1 = parseWrite(cli("submit_contribution", [
  "crypto",
  "What is proof-of-work?",
  "https://en.wikipedia.org/wiki/Proof-of-work",
  "Proof-of-work is a consensus mechanism that requires computational effort to validate blocks and secure a blockchain network against attackers.",
]));
console.log(`  write: exec=${w1.execRes} result=${w1.resultName} lifecycle=${w1.statusName}`);
ok("submit#1 lifecycle ACCEPTED/FINALIZED", ["ACCEPTED", "FINALIZED"].includes(w1.statusName), w1.statusName);
ok("submit#1 execution SUCCESS", w1.execRes === "SUCCESS", w1.execRes);

const vr1 = await call("get_validation_result", [1]);
console.log("  vr#1:", JSON.stringify(vr1));
ok("entry#1 exists id==1", vr1.id === 1, String(vr1.id));
ok("entry#1 status PENDING", vr1.status === "PENDING", vr1.status);
ok("entry#1 score==0", vr1.ai_score === 0, String(vr1.ai_score));
ok("entry#1 accepted==false", vr1.accepted === false);
ok("entry#1 threshold==7", vr1.threshold === 7);
ok("entry#1 topic normalized", vr1.topic === "crypto");
ok("entry#1 url bound", vr1.source_url === "https://en.wikipedia.org/wiki/Proof-of-work");
ok("entry#1 contributor set", /^0x[0-9a-fA-F]{40}$/.test(vr1.contributor), vr1.contributor);
ok("entry#1 settled_reward==0 while PENDING", String(vr1.settled_reward) === "0");

const e1 = await call("get_entry", [1]);
ok("get_entry#1 fields", e1.title === "What is proof-of-work?" && e1.status === "PENDING" && e1.contributor === vr1.contributor);

const pend = await call("get_pending_entries");
ok("pending contains #1", pend.length === 1 && pend[0].id === 1, JSON.stringify(pend));
const all1 = await call("get_all_entries", [1, 10]);
ok("all total==1", all1.total === 1, JSON.stringify(all1));
const tps = await call("get_topics");
ok("topics contains crypto", tps.includes("crypto"), JSON.stringify(tps));

section("E2E 3: submit entry#2 (for cancel + non-owner tests)");
await rate();
const w2 = parseWrite(cli("submit_contribution", [
  "tech", "Blockchain overview",
  "https://en.wikipedia.org/wiki/Blockchain",
  "A blockchain is a distributed ledger that records transactions across many computers so records cannot be altered retroactively.",
]));
ok("submit#2 SUCCESS", w2.execRes === "SUCCESS", w2.execRes);
const vr2 = await call("get_validation_result", [2]);
ok("entry#2 PENDING", vr2.status === "PENDING", vr2.status);

section("E2E 4: cancel_pending (owner escape path)");
await rate();
const w3 = parseWrite(cli("cancel_pending", [2]));
ok("cancel#2 SUCCESS", w3.execRes === "SUCCESS", w3.execRes);
const vr2c = await call("get_validation_result", [2]);
ok("entry#2 CANCELLED", vr2c.status === "CANCELLED", vr2c.status);
ok("entry#2 settled_reward==0", String(vr2c.settled_reward) === "0");
ok("cancel idempotence: pending no longer has #2", (await call("get_pending_entries")).every((p) => p.id !== 2));

section("E2E 5: validate_contribution with REAL LLM consensus (entry #1)");
// Reward payouts need contract balance — fund the pool first (plain GEN transfer).
// CLI --fee-value does NOT attach msg.value (verified live), so fund via account send.
console.log("  funding contract pool with 1 GEN...");
await rate();
const fund = cliRaw(["account", "send", ADDR, "1gen"]);
ok("pool funded", /amount: '1 GEN'/.test(fund) || /Transfer successful/i.test(fund), fund.slice(-300));
// Live-web LLM consensus can occasionally end UNDETERMINED (validators fetch
// the page at slightly different times / model outputs vary). Entry stays
// PENDING — safe to retry. Max 3 attempts, dump votes on disagreement.
let validateOk = false;
for (let attempt = 1; attempt <= 3 && !validateOk; attempt++) {
  console.log(`  validate_contribution(1) attempt ${attempt}/3 — LLM consensus, may take minutes...`);
  await rate();
  const w4 = parseWrite(cli("validate_contribution", [1]));
  console.log(`  write: exec=${w4.execRes} result=${w4.resultName} lifecycle=${w4.statusName}`);
  if (w4.execRes === "SUCCESS" && ["ACCEPTED", "FINALIZED"].includes(w4.statusName)) {
    validateOk = true;
    ok("validate#1 execution SUCCESS", true);
  } else {
    const hash = w4.out.match(/Transaction Hash['":\s]+(0x[0-9a-fA-F]{64})/)?.[1];
    console.log(`  UNDETERMINED/ERROR — tx=${hash ?? "?"} (entry remains PENDING, retrying)`);
    if (hash) {
      const rec = cliRaw(["receipt", hash]);
      const votes = rec.match(/validator_votes_name: \[[^\]]*\]/)?.[0] ?? "";
      const leaderErr = rec.match(/raw_error: \{[^}]*\}/)?.[0] ?? "";
      console.log("  diagnostics:", votes, leaderErr);
    }
    await sleep(10000);
  }
}
ok("validate#1 settled on-chain (or documented live variance)", validateOk, "still UNDETERMINED after 3 tries");

let vr1f = await call("get_validation_result", [1]);
console.log("  vr#1 after validate:", JSON.stringify(vr1f));
if (vr1f.status === "ACCEPTED") {
  ok("entry#1 accepted==true", vr1f.accepted === true);
  ok("entry#1 settled_reward==reward_amount", String(vr1f.settled_reward) === REWARD, String(vr1f.settled_reward));
} else if (vr1f.status === "REJECTED") {
  ok("entry#1 rejected => reward 0", String(vr1f.settled_reward) === "0", String(vr1f.settled_reward));
} else {
  // live consensus stayed UNDETERMINED — exercise the owner escape path to reach a terminal state
  console.log("  still PENDING after retries → exercising cancel_pending escape path");
  await rate();
  const wc = parseWrite(cli("cancel_pending", [1]));
  ok("escape: cancel PENDING entry#1 SUCCESS", wc.execRes === "SUCCESS", wc.execRes);
  vr1f = await call("get_validation_result", [1]);
}
ok("entry#1 terminal after suite", ["ACCEPTED", "REJECTED", "CANCELLED"].includes(vr1f.status), vr1f.status);
ok("entry#1 score in 0..10", vr1f.ai_score >= 0 && vr1f.ai_score <= 10, String(vr1f.ai_score));
ok("entry#1 summary non-empty", typeof vr1f.ai_summary === "string" && vr1f.ai_summary.length > 0);

section("E2E 6: views after settlement");
const lb = await call("get_leaderboard", [10]);
console.log("  leaderboard:", JSON.stringify(lb));
ok("leaderboard has contributor", lb.length === 1 && /^0x[0-9a-fA-F]{40}$/.test(lb[0].contributor));
ok("leaderboard submitted==2", Number(lb[0].submitted) === 2, String(lb[0].submitted));
ok("leaderboard accepted==1 iff ACCEPTED", Number(lb[0].accepted) === (vr1f.status === "ACCEPTED" ? 1 : 0));
const cs = await call("get_contributor_stats", [vr1f.contributor]);
ok("contributor_stats matches", Number(cs.submitted) === 2 && Number(cs.accepted) === Number(lb[0].accepted));
const acc = await call("get_accepted_entries", ["", 10]);
ok("accepted_entries matches status", acc.length === (vr1f.status === "ACCEPTED" ? 1 : 0), JSON.stringify(acc));
const accCrypto = await call("get_accepted_entries", ["CRYPTO", 10]); // topic case-insensitive
ok("accepted_entries topic case-insensitive", accCrypto.length === acc.length);
const all2 = await call("get_all_entries", [1, 10]);
ok("all total==2", all2.total === 2, String(all2.total));

// ---------------------------------------------------------------- ADVERSARIAL
section("ADV 1: submit input validation");
await rate();
// NOTE: genlayer CLI parseScalar coerces whitespace-only strings to int 0
// (Number(" ")===0), so a true "topic-only-spaces" arg never reaches the
// contract via CLI — the VM rejects the wrong type (fail-closed, no entry).
// Contract-level strip() guards are covered by tests/direct (bypass CLI).
const a1 = parseWrite(cli("submit_contribution", ["  ", "Title", "https://example.com/a", "A perfectly valid long enough summary text here."]));
ok("whitespace topic fails closed (no entry)", a1.execRes === "ERROR", `${a1.execRes} | ${a1.out.match(/payload: [^,}]*/)?.[0] ?? ""}`);
await rate();
const a2 = parseWrite(cli("submit_contribution", ["crypto", "T", "https://example.com/b", "too short"]));
ok("short summary rejected", a2.execRes === "ERROR" && /min 20 chars/.test(a2.out), a2.execRes);
await rate();
const a3 = parseWrite(cli("submit_contribution", ["crypto", "Title", "ftp://example.com/x", "A perfectly valid long enough summary text here."]));
ok("non-http url rejected", a3.execRes === "ERROR" && /must start with http/.test(a3.out), a3.execRes);
await rate();
const a4 = parseWrite(cli("submit_contribution", ["crypto", "Dup", "https://en.wikipedia.org/wiki/Proof-of-work", "A perfectly valid long enough summary text here."]));
ok("duplicate source_url rejected", a4.execRes === "ERROR" && /already submitted as entry 1/.test(a4.out), a4.execRes);
await rate();
const a5 = parseWrite(cli("submit_contribution", ["crypto", "", "https://example.com/c", "A perfectly valid long enough summary text here."]));
ok("whitespace title fails closed (no entry)", a5.execRes === "ERROR", `${a5.execRes} | ${a5.out.match(/payload: [^,}]*/)?.[0] ?? ""}`);

section("ADV 2: entry existence + state guards");
await rate();
const a6 = parseWrite(cli("validate_contribution", [999]));
ok("validate missing entry rejected", a6.execRes === "ERROR" && /not found/.test(a6.out), a6.execRes);
await rate();
const a7 = parseWrite(cli("validate_contribution", [2]));
ok("validate CANCELLED entry rejected", a7.execRes === "ERROR" && /already CANCELLED/.test(a7.out), a7.execRes);
await rate();
const a8 = parseWrite(cli("cancel_pending", [1]));
const expectCancelTerminal = new RegExp(`already ${vr1f.status}`);
ok("cancel settled entry rejected", a8.execRes === "ERROR" && expectCancelTerminal.test(a8.out), a8.execRes);
await rate();
const a9 = parseWrite(cli("cancel_pending", [999]));
ok("cancel missing entry rejected", a9.execRes === "ERROR" && /not found/.test(a9.out), a9.execRes);
await rate();
const a10 = parseWrite(cli("validate_contribution", [1]));
ok("double-validate settled entry rejected", a10.execRes === "ERROR" && expectCancelTerminal.test(a10.out), a10.execRes);

let vrMissing = null;
try { vrMissing = await call("get_validation_result", [999]); } catch (e) { vrMissing = { threw: true }; }
ok("get_validation_result(999) throws", vrMissing?.threw === true, JSON.stringify(vrMissing));
let geMissing = null;
try { geMissing = await call("get_entry", [999]); } catch (e) { geMissing = { threw: true }; }
ok("get_entry(999) throws", geMissing?.threw === true, JSON.stringify(geMissing));

section("ADV 3: owner guards");
await rate();
const a11 = parseWrite(cli("fund_pool", [])); // no value attached
ok("fund_pool with 0 value rejected", a11.execRes === "ERROR" && /Send some GEN/.test(a11.out), a11.execRes);
await rate();
const a12 = parseWrite(cli("set_reward_amount", [REWARD])); // owner, same value — safe
ok("set_reward_amount by owner ok", a12.execRes === "SUCCESS", a12.execRes);
const s1 = await call("get_stats");
ok("reward unchanged", String(s1.reward_amount) === REWARD, String(s1.reward_amount));
const allFinal = await call("get_all_entries", [1, 10]);
ok("no phantom entries from failed submits", allFinal.total === 2, String(allFinal.total));

console.log(`\n================ RESULT: ${passed} passed, ${failed} failed ================`);
if (failures.length) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
