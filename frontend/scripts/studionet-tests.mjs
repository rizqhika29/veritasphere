// Veritasphere v2 studionet E2E + adversarial suite.
// Run: CONTRACT=0x... node scripts/studionet-tests.mjs  (contract defaults to
// frontend/.env.production). Reads use genlayer-js (no wallet). Writes shell
// out to the genlayer CLI (active unlocked account — npm i -g genlayer).
// v2: pool ledger (fund_pool credits; plain transfers do NOT), reward reserved
// at submit, paginated dict views, owner-cancel justification, audit trail.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient, createAccount } from "genlayer-js";
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
const ONE = 10n ** 18n;

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
  // The studionet endpoint occasionally answers with an HTML error page
  // (WAF/rate-shaper) instead of JSON — viem throws UnknownRpcError. Retry
  // with backoff rather than crashing the whole suite on one bad read.
  let lastErr;
  for (let i = 0; i < 12; i++) {
    try {
      const r = await client.readContract({ address: ADDR, functionName: fn, args });
      return dec(r);
    } catch (e) {
      lastErr = e;
      await sleep(10000);
    }
  }
  throw lastErr;
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

// fund_pool needs real msg.value — CLI has no value flag, so a local
// genlayer-js account signs it (same path as money-flow S2).
async function fundPool(valueWei) {
  const local = createAccount();
  const send = cliRaw(["account", "send", local.address, `${(Number(valueWei) / 1e18)}gen`]);
  if (!/Transfer successful|amount:/i.test(send)) return { ok: false, out: send.slice(-300) };
  const localClient = createClient({ chain: studionet, account: local });
  const hash = await localClient.writeContract({ address: ADDR, functionName: "fund_pool", args: [], value: valueWei });
  const cadence = [15000, 15000, 20000];
  for (let i = 0; i < 24; i++) {
    const tx = await localClient.getTransaction({ hash });
    if (tx?.statusName === "FINALIZED") return { ok: true, hash };
    if (["REJECTED", "FAILED", "UNDETERMINED"].includes(tx?.statusName)) return { ok: false, hash, status: tx.statusName };
    await sleep(cadence[i] ?? 20000);
  }
  return { ok: false, hash, status: "timeout" };
}

// ---------------------------------------------------------------- E2E
section("E2E 1: initial state (v2 ledger fields)");
const s0 = await call("get_stats");
console.log("  get_stats:", JSON.stringify(s0));
ok("stats total_entries==0", s0.total_entries === 0, `got ${s0.total_entries}`);
ok("stats reward==1e17", String(s0.reward_amount) === REWARD, `got ${s0.reward_amount}`);
ok("name==Veritasphere", s0.name === "Veritasphere");
ok("v2 pool/reserved/available present", s0.pool_balance === "0" && s0.reserved_balance === "0" && s0.available_balance === "0", JSON.stringify({ pool: s0.pool_balance, reserved: s0.reserved_balance }));
ok("pending_count==0", Number(s0.pending_count) === 0, String(s0.pending_count));
const emptyAll = await call("get_all_entries", [1, 10]);
ok("get_all_entries empty", emptyAll.total === 0 && emptyAll.entries.length === 0, JSON.stringify(emptyAll));
ok("get_topics empty", (await call("get_topics")).length === 0);
const emptyPending = await call("get_pending_entries", [0, 20]);
ok("get_pending_entries empty", emptyPending.total === 0 && emptyPending.entries.length === 0, JSON.stringify(emptyPending));
const emptyLb = await call("get_leaderboard", [0, 10]);
ok("get_leaderboard empty", emptyLb.total === 0 && emptyLb.entries.length === 0);
const emptyAcc = await call("get_accepted_entries", ["", 0, 10]);
ok("get_accepted_entries empty", emptyAcc.total === 0 && emptyAcc.entries.length === 0);

section("E2E 1.5: fund_pool via real msg.value (ledger credit — prerequisite for submit)");
// v2: submit reserves the advertised reward from the pool — fund 0.5 GEN
// (2 submits reserve 0.2; cancel + payout exercise the rest).
{
  const f = await fundPool(ONE / 2n);
  ok("fund_pool 0.5 GEN FINALIZED", f.ok, JSON.stringify(f));
  const sf = await call("get_stats");
  ok("pool_balance==5e17", String(sf.pool_balance) === "500000000000000000", String(sf.pool_balance));
  ok("available==5e17 (nothing reserved yet)", String(sf.available_balance) === "500000000000000000", String(sf.available_balance));
}

section("E2E 2: submit_contribution happy path (entry #1, reward reserved)");
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
ok("entry#1 committed_reward==reward (reserved at submit)", String(vr1.committed_reward) === REWARD, String(vr1.committed_reward));

const e1 = await call("get_entry", [1]);
ok("get_entry#1 fields", e1.title === "What is proof-of-work?" && e1.status === "PENDING" && e1.contributor === vr1.contributor);

const sAfter1 = await call("get_stats");
ok("reserved==1e17 after submit#1", String(sAfter1.reserved_balance) === REWARD, String(sAfter1.reserved_balance));
ok("available==4e17 after submit#1", String(sAfter1.available_balance) === "400000000000000000", String(sAfter1.available_balance));

const pend = await call("get_pending_entries", [0, 20]);
ok("pending contains #1", pend.total === 1 && pend.entries[0].id === 1, JSON.stringify(pend));
const all1 = await call("get_all_entries", [1, 10]);
ok("all total==1", all1.total === 1, JSON.stringify(all1));
const tps = await call("get_topics");
ok("topics contains crypto", tps.includes("crypto"), JSON.stringify(tps));

section("E2E 3: submit entry#2 (for cancel + reservation-release tests)");
await rate();
const w2 = parseWrite(cli("submit_contribution", [
  "tech", "Blockchain overview",
  "https://en.wikipedia.org/wiki/Blockchain",
  "A blockchain is a distributed ledger that records transactions across many computers so records cannot be altered retroactively.",
]));
ok("submit#2 SUCCESS", w2.execRes === "SUCCESS", w2.execRes);
const vr2 = await call("get_validation_result", [2]);
ok("entry#2 PENDING", vr2.status === "PENDING", vr2.status);
const sAfter2 = await call("get_stats");
ok("reserved==2e17 after submit#2", String(sAfter2.reserved_balance) === "200000000000000000", String(sAfter2.reserved_balance));

section("E2E 4: cancel_pending (owner escape path, justification required + audited)");
await rate();
// NB: a whitespace-only "" arg would be coerced by CLI parseScalar to int 0
// (fails as a type error, not the contract guard) — use a short real string.
const noJust = parseWrite(cli("cancel_pending", [2, "x"])); // owner, 1 char < min 10
ok("owner cancel without justification rejected", noJust.execRes === "ERROR" && /requires justification/.test(noJust.out), noJust.execRes);
await rate();
const w3 = parseWrite(cli("cancel_pending", [2, "source unreachable during live validation window"]));
ok("cancel#2 SUCCESS with justification", w3.execRes === "SUCCESS", w3.execRes);
const vr2c = await call("get_validation_result", [2]);
ok("entry#2 CANCELLED", vr2c.status === "CANCELLED", vr2c.status);
ok("entry#2 settled_reward==0", String(vr2c.settled_reward) === "0");
ok("cancel releases reservation (reserved back to 1e17)", String((await call("get_stats")).reserved_balance) === REWARD, String((await call("get_stats")).reserved_balance));
ok("cancel idempotence: pending no longer has #2", (await call("get_pending_entries", [0, 20])).entries.every((p) => p.id !== 2));
const audit1 = await call("get_audit", [0, 20]);
ok("audit has OWNER_CANCEL for #2", audit1.entries.some((a) => a.action === "OWNER_CANCEL" && Number(a.entry_id) === 2), JSON.stringify(audit1));

section("E2E 5: validate_contribution with REAL LLM consensus (entry #1)");
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
  ok("entry#1 evidence_hash committed (0x-prefixed)", typeof vr1f.evidence_hash === "string" && vr1f.evidence_hash.startsWith("0x"), String(vr1f.evidence_hash));
  ok("entry#1 evidence_len>0", Number(vr1f.evidence_len) > 0, String(vr1f.evidence_len));
  const sSettled = await call("get_stats");
  ok("settlement: reserved released (back to 0)", String(sSettled.reserved_balance) === "0", String(sSettled.reserved_balance));
  ok("settlement: pool_balance decremented by reward", String(sSettled.pool_balance) === "400000000000000000", String(sSettled.pool_balance));
} else if (vr1f.status === "REJECTED") {
  ok("entry#1 rejected => reward 0", String(vr1f.settled_reward) === "0", String(vr1f.settled_reward));
  const sSettled = await call("get_stats");
  ok("rejection: reserved released", String(sSettled.reserved_balance) === "0", String(sSettled.reserved_balance));
} else {
  // live consensus stayed UNDETERMINED — exercise the owner escape path to reach a terminal state
  console.log("  still PENDING after retries → exercising cancel_pending escape path");
  await rate();
  const wc = parseWrite(cli("cancel_pending", [1, "consensus inconclusive after retries"]));
  ok("escape: cancel PENDING entry#1 SUCCESS", wc.execRes === "SUCCESS", wc.execRes);
  vr1f = await call("get_validation_result", [1]);
}
ok("entry#1 terminal after suite", ["ACCEPTED", "REJECTED", "CANCELLED"].includes(vr1f.status), vr1f.status);
ok("entry#1 score in 0..10", vr1f.ai_score >= 0 && vr1f.ai_score <= 10, String(vr1f.ai_score));
ok("entry#1 summary non-empty", typeof vr1f.ai_summary === "string" && vr1f.ai_summary.length > 0);

section("E2E 6: views after settlement (v2 paginated dicts)");
const lb = await call("get_leaderboard", [0, 10]);
console.log("  leaderboard:", JSON.stringify(lb));
ok("leaderboard has contributor", lb.total === 1 && /^0x[0-9a-fA-F]{40}$/.test(lb.entries[0].contributor));
ok("leaderboard submitted==2", Number(lb.entries[0].submitted) === 2, String(lb.entries[0].submitted));
ok("leaderboard accepted==1 iff ACCEPTED", Number(lb.entries[0].accepted) === (vr1f.status === "ACCEPTED" ? 1 : 0));
const cs = await call("get_contributor_stats", [vr1f.contributor]);
ok("contributor_stats matches", Number(cs.submitted) === 2 && Number(cs.accepted) === Number(lb.entries[0].accepted));
const acc = await call("get_accepted_entries", ["", 0, 10]);
ok("accepted_entries matches status", acc.total === (vr1f.status === "ACCEPTED" ? 1 : 0), JSON.stringify(acc));
const accCrypto = await call("get_accepted_entries", ["CRYPTO", 0, 10]); // topic case-insensitive
ok("accepted_entries topic case-insensitive", accCrypto.total === acc.total);
const accTopic = await call("get_accepted_entries", ["crypto", 0, 10]);
ok("accepted_entries by topic registry", accTopic.total === acc.total);
const all2 = await call("get_all_entries", [1, 10]);
ok("all total==2", all2.total === 2, String(all2.total));

// ---------------------------------------------------------------- ADVERSARIAL
section("ADV 1: submit input validation (representative — full matrix in tests/direct)");
// NOTE: genlayer CLI parseScalar coerces whitespace-only strings to int 0
// (Number(" ")===0), so some empty-field guards can't be exercised via CLI —
// contract-level strip() guards are covered by tests/direct (bypass CLI).
await rate();
const a2 = parseWrite(cli("submit_contribution", ["crypto", "T", "https://example.com/b", "too short"]));
ok("short summary rejected", a2.execRes === "ERROR" && /min 20 chars/.test(a2.out), a2.execRes);
await rate();
const a3 = parseWrite(cli("submit_contribution", ["crypto", "Title", "ftp://example.com/x", "A perfectly valid long enough summary text here."]));
ok("non-http url rejected", a3.execRes === "ERROR" && /must start with https/.test(a3.out), a3.execRes);
await rate();
const a4 = parseWrite(cli("submit_contribution", ["crypto", "Dup", "https://en.wikipedia.org/wiki/Proof-of-work", "A perfectly valid long enough summary text here."]));
ok("duplicate source_url rejected", a4.execRes === "ERROR" && /already submitted as entry 1/.test(a4.out), a4.execRes);

section("ADV 2: entry existence + state guards (representative)");
await rate();
const a6 = parseWrite(cli("validate_contribution", [999]));
ok("validate missing entry rejected", a6.execRes === "ERROR" && /not found/.test(a6.out), a6.execRes);
await rate();
const a7 = parseWrite(cli("validate_contribution", [2]));
ok("validate CANCELLED entry rejected", a7.execRes === "ERROR" && /already CANCELLED/.test(a7.out), a7.execRes);
await rate();
const a8 = parseWrite(cli("cancel_pending", [1, "attempting to cancel a settled entry"]));
const expectCancelTerminal = new RegExp(`already ${vr1f.status}`);
ok("cancel settled entry rejected", a8.execRes === "ERROR" && expectCancelTerminal.test(a8.out), a8.execRes);
await rate();
const aAppeal = parseWrite(cli("appeal_cancellation", [1, "settled entry appeal probe reason"])); // settled, not CANCELLED
ok("appeal on settled entry rejected", aAppeal.execRes === "ERROR" && /not CANCELLED/.test(aAppeal.out), aAppeal.execRes);

let vrMissing = null;
try { vrMissing = await call("get_validation_result", [999]); } catch (e) { vrMissing = { threw: true }; }
ok("get_validation_result(999) throws", vrMissing?.threw === true, JSON.stringify(vrMissing));
let geMissing = null;
try { geMissing = await call("get_entry", [999]); } catch (e) { geMissing = { threw: true }; }
ok("get_entry(999) throws", geMissing?.threw === true, JSON.stringify(geMissing));

section("ADV 3: owner guards + ledger integrity");
await rate();
const a11 = parseWrite(cli("fund_pool", [])); // no value attached
ok("fund_pool with 0 value rejected", a11.execRes === "ERROR" && /Send some GEN/.test(a11.out), a11.execRes);
await rate();
const a12 = parseWrite(cli("set_reward_amount", [REWARD])); // owner, same value — safe
ok("set_reward_amount by owner ok", a12.execRes === "SUCCESS", a12.execRes);
const s1 = await call("get_stats");
ok("reward unchanged", String(s1.reward_amount) === REWARD, String(s1.reward_amount));
ok("set_reward audited", (await call("get_audit", [0, 20])).entries.some((a) => a.action === "SET_REWARD"));
const allFinal = await call("get_all_entries", [1, 10]);
ok("no phantom entries from failed submits", allFinal.total === 2, String(allFinal.total));

console.log(`\n================ RESULT: ${passed} passed, ${failed} failed ================`);
if (failures.length) { console.log("Failures:"); failures.forEach((f) => console.log("  - " + f)); process.exit(1); }
