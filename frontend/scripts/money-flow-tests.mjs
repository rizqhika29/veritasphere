// Veritasphere v2 money-flow tests — proves GEN ACTUALLY MOVES for every pay path.
//
// What this suite asserts with REAL balance deltas (eth_getBalance on studionet)
// and LEDGER reads (get_stats pool/reserved/available):
//   S0  writes are gasless (no sender balance debit) → exact deltas meaningful
//   S1  plain transfer IN → physical contract +0.5 GEN, pool_balance UNCHANGED
//       (v2: uncounted donation — only fund_pool credits the ledger)
//   S2  fund_pool() payable SUCCESS via msg.value → ledger pool_balance +0.1
//   S3  submit reserves reward (reserved_balance==reward, available drops)
//       settle payout → contributor +reward EXACT, contract -reward EXACT,
//       pool_balance -reward, reserved released (core "method pay" — real LLM)
//   S4  withdraw() → owner/zero/non-owner/reserved-locked guards, then
//       recipient +0.01 GEN / contract -0.01 GEN exact; ledger decrements
//
// Balance reads are EVENTUALLY CONSISTENT: eth_getBalance reflects finalized
// state and lags a tx by seconds-to-minutes. Every assertion therefore WAITS
// for the expected value (waitForBalance) instead of reading right after.
//
// Run: node scripts/money-flow-tests.mjs   (contract from frontend/.env.production;
//      owner/contributor = active genlayer CLI account — npm i -g genlayer)
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
      shell: process.platform === "win32",
    });
    const p = join(out.trim(), "genlayer", "dist", "index.js");
    if (existsSync(p)) return p;
  } catch { /* fall through */ }
  console.error("genlayer CLI not found — npm i -g genlayer (or set GENLAYER_CLI).");
  process.exit(1);
}
const CLI = resolveGenlayerCli();

function resolveEnv() {
  const file = join(here, "..", ".env.production");
  const env = readFileSync(file, "utf8");
  const get = (k) => env.match(new RegExp(`^${k}=(.+)$`, "m"))?.[1]?.trim();
  return {
    address: process.env.CONTRACT ?? get("NEXT_PUBLIC_CONTRACT_ADDRESS") ?? "",
    rpc: process.env.NEXT_PUBLIC_RPC_URL ?? get("NEXT_PUBLIC_RPC_URL") ?? "https://studio.genlayer.com/api",
  };
}
const { address: ADDR, rpc: RPC_URL } = resolveEnv();
if (!/^0x[0-9a-fA-F]{40}$/.test(ADDR)) {
  console.error("Contract address missing/invalid — set CONTRACT or frontend/.env.production.");
  process.exit(1);
}

const ONE = 10n ** 18n; // GEN has 18 decimals
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = createClient({ chain: studionet, endpoint: RPC_URL });

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, extra = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(name + (extra ? ` — ${extra}` : "")); console.log(`  FAIL  ${name} ${extra}`); }
}
function section(t) { console.log(`\n=== ${t} ===`); }
const gen = (wei) => (Number(wei) / 1e18).toFixed(6);

// ---- raw JSON-RPC balance (genlayer-js has no getBalance; eth_getBalance works).
// The endpoint occasionally answers with an HTML error page (WAF/rate-shaper)
// — parse defensively and retry with backoff instead of crashing.
async function balance(addr, tries = 5) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }),
      });
      const text = await r.text();
      let j;
      try { j = JSON.parse(text); }
      catch { throw new Error(`non-JSON RPC response (HTTP ${r.status}): ${text.slice(0, 80).replace(/\s+/g, " ")}`); }
      if (j.error || !j.result) throw new Error(`eth_getBalance(${addr}): ${JSON.stringify(j.error ?? j)}`);
      return BigInt(j.result);
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(4000 * (i + 1));
    }
  }
  throw lastErr;
}
// Balance layer is eventually consistent — wait until it reads `expected`.
// Polling is deliberately gentle: studionet rate-limits ~500 req/hr per IP and
// this suite shares that budget with the CLI writes.
async function waitForBalance(addr, expected, { timeout = 240_000, every = 30_000 } = {}) {
  const t0 = Date.now();
  let seen = 0n;
  while (Date.now() - t0 < timeout) {
    seen = await balance(addr);
    if (seen === expected) return { ok: true, seen };
    await sleep(every);
  }
  return { ok: false, seen };
}
async function expectBalance(name, addr, expected, timeout = 240_000) {
  const r = await waitForBalance(addr, expected, { timeout });
  ok(name, r.ok, `reads ${gen(r.seen)} GEN, expected ${gen(expected)}`);
  return r.ok;
}
// Ledger reads use LATEST_FINAL — retry before asserting.
async function stats() {
  for (let i = 0; i < 4; i++) {
    try { return await client.readContract({ address: ADDR, functionName: "get_stats", args: [] }); }
    catch { await sleep(5000); }
  }
  throw new Error("get_stats unreachable");
}
async function expectLedger(name, { pool, reserved, available }) {
  const s = await stats();
  const cond =
    (pool === undefined || String(s.pool_balance) === String(pool)) &&
    (reserved === undefined || String(s.reserved_balance) === String(reserved)) &&
    (available === undefined || String(s.available_balance) === String(available));
  ok(name, cond, `pool=${s.pool_balance} reserved=${s.reserved_balance} available=${s.available_balance}`);
}

// ---- CLI (owner account writes; CLI blocks until consensus decided) ----
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
  const safeArgs = args.map((a) => (a === "" ? " " : String(a)));
  if (safeArgs.length) argv.push("--args", ...safeArgs);
  return cliRaw(argv, { timeout });
}
function parseWrite(out) {
  return {
    execRes: out.match(/execution_result: '([A-Z_]+)'/)?.[1] ?? "?",
    resultName: out.match(/result_name: '([A-Z_]+)'/)?.[1] ?? "?",
    statusName: out.match(/status_name: '([A-Z_]+)'/)?.[1] ?? "?",
    hash: out.match(/Transaction Hash['":\s]+(0x[0-9a-fA-F]{64})/)?.[1] ?? "",
    out,
  };
}
async function call(fn, args = []) {
  const r = await client.readContract({ address: ADDR, functionName: fn, args });
  return typeof r === "bigint" ? Number(r) : r;
}
// Read-after-write: LATEST_FINAL may lag a beat — retry before asserting.
async function callRetry(fn, args = [], tries = 6) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await call(fn, args); }
    catch (e) { lastErr = e; await sleep(3000); }
  }
  throw lastErr;
}

// ---- genlayer-js write wait: poll until FINALIZED (same as lib/genlayer.ts).
// leader-exec SUCCESS alone is NOT the user-visible done signal — consensus
// can still flip while the window is open.
const FINAL_STATES = new Set(["FINALIZED", "REJECTED", "FAILED", "UNDETERMINED"]);
async function writeAndWait(clientRef, call2) {
  const hash = await clientRef.writeContract({ address: ADDR, ...call2 });
  // ~15–20s cadence: FINALIZED typically lands in 1–5 min → 4–20 polls/tx.
  const cadence = [15000, 15000, 20000];
  for (let i = 0; i < 24; i++) {
    const tx = await clientRef.getTransaction({ hash });
    const lr = tx?.consensus_data?.leader_receipt?.[0];
    const exec = lr?.execution_result ?? "";
    const statusName = tx.statusName ?? "";
    if (FINAL_STATES.has(statusName)) {
      const msg = String(lr?.result?.payload ?? lr?.raw_error ?? "");
      return { hash, exec, statusName, msg };
    }
    await sleep(cadence[i] ?? 20000);
  }
  return { hash, exec: "", statusName: "timeout", msg: "" };
}
const cliOk = (out) => !out.includes("[CLI-EXIT");

// ================================================================== S0
section("S0: gasless probe — a no-op write must NOT debit the sender balance");
const ownerShow = cliRaw(["account", "show"]);
const OWNER = ownerShow.match(/address: '(0x[0-9a-fA-F]{40})'/)?.[1];
if (!OWNER) { console.error("Cannot read active account from `account show`:\n" + ownerShow); process.exit(1); }
console.log(`  owner/contributor: ${OWNER}`);
let OWNER_BAL = 0n;
const stats0 = await stats();
const curReward = String(stats0.reward_amount);
console.log(`  contract ${ADDR} physical=${gen(await balance(ADDR))} GEN | ledger pool=${stats0.pool_balance} reserved=${stats0.reserved_balance} | reward=${curReward}`);
{
  const before = await balance(OWNER);
  const w = parseWrite(cli("set_reward_amount", [curReward])); // owner, same value → no state change
  await sleep(15000); // give any (unexpected) fee debit time to surface in the balance layer
  const after = await balance(OWNER);
  ok("no-op write SUCCESS", w.execRes === "SUCCESS", w.execRes);
  ok("writes are gasless (sender delta == 0)", after === before, `delta=${after - before}`);
  ok("reward unchanged", String((await stats()).reward_amount) === curReward);
  OWNER_BAL = after; // settled snapshot — S1 waits for the 0.5 debit against this
}

// ================================================================== S1
section("S1: plain transfer IN — physical +0.5 GEN, ledger UNCHANGED (uncounted donation)");
let cAfter1 = 0n;
{
  const ledgerBefore = await stats();
  const cBefore = await balance(ADDR); // previous-run ops are long settled by now
  const sent = cliRaw(["account", "send", ADDR, "0.5gen"]);
  ok("account send accepted", cliOk(sent) && /0\.5/.test(sent), sent.slice(-300));
  cAfter1 = cBefore + ONE / 2n;
  await expectBalance("contract physical +0.5 GEN exact", ADDR, cAfter1);
  await expectBalance("owner debit visible (settled before S3 snapshot)", OWNER, OWNER_BAL - ONE / 2n);
  // v2 invariant: only fund_pool credits the ledger — a raw transfer is a
  // donation that does NOT increase withdrawable/available balance.
  await expectLedger("pool_balance unchanged by plain transfer", {
    pool: ledgerBefore.pool_balance,
    reserved: ledgerBefore.reserved_balance,
  });
}

// ================================================================== S2
section("S2: fund_pool() payable SUCCESS with real msg.value (genlayer-js value param)");
const local = createAccount();
console.log(`  fresh local signer: ${local.address}`);
{
  const sent = cliRaw(["account", "send", local.address, "0.6gen"]);
  ok("funded local signer 0.6 GEN (arbitrary address)", cliOk(sent) && /0\.6/.test(sent), sent.slice(-300));
  await expectBalance("local signer balance reads 0.6 GEN", local.address, (ONE * 6n) / 10n);
}
const clientLocal = createClient({ chain: studionet, endpoint: RPC_URL, account: local });
const ledgerBeforeS2 = await stats();
const poolBeforeS2 = BigInt(String(ledgerBeforeS2.pool_balance));
{
  // 0.5 GEN: S3 payout (reward) + S4 lock-probe reserve + 0.01 withdraw all
  // draw from the ledger — a fresh v2 contract starts with pool_balance 0.
  const r = await writeAndWait(clientLocal, { functionName: "fund_pool", args: [], value: ONE / 2n });
  ok("fund_pool msg.value=0.5 exec SUCCESS + FINALIZED", r.exec === "SUCCESS" && r.statusName === "FINALIZED", `exec=${r.exec} status=${r.statusName} tx=${r.hash}`);
  await expectBalance("local signer -0.5 (reads 0.1 GEN)", local.address, ONE / 10n);
  await expectBalance("contract physical +0.5 via msg.value exact", ADDR, cAfter1 + ONE / 2n);
  await expectLedger("ledger: pool_balance +0.5 exact (fund_pool credits)", {
    pool: poolBeforeS2 + ONE / 2n,
    available: BigInt(String(ledgerBeforeS2.available_balance)) + ONE / 2n,
  });
}

// ================================================================== S3
section("S3: settle payout — contributor +EXACT reward; ledger reserves then releases");
const stats3 = await stats();
const nextId = Number(stats3.total_entries) + 1;
const REWARD = BigInt(String(stats3.reward_amount));
let C_AFTER_S3 = 0n;
let RESERVED_BEFORE = 0n;
console.log(`  next entry id: #${nextId} | reward: ${gen(REWARD)} GEN | available: ${gen(stats3.available_balance)} GEN`);
{
  // v2 gate: submission itself fails when the pool can't cover the reward.
  ok("available pool covers reward before submit", BigInt(String(stats3.available_balance)) >= REWARD, String(stats3.available_balance));

  const url = `https://en.wikipedia.org/wiki/Double-spending?run=${Date.now()}`;
  await sleep(4000);
  const wSub = parseWrite(cli("submit_contribution", [
    "crypto",
    "Double-spending prevention",
    url,
    "Double-spending is the risk that a digital currency can be spent more than once, which blockchains prevent by recording every transaction on a distributed ledger.",
  ]));
  ok(`submit#${nextId} SUCCESS`, wSub.execRes === "SUCCESS", wSub.execRes);
  const vr0 = await callRetry("get_validation_result", [nextId]);
  ok(`entry#${nextId} PENDING`, vr0.status === "PENDING", vr0.status);
  ok(`entry#${nextId} contributor == owner (CLI signer)`,
    String(vr0.contributor).toLowerCase() === OWNER.toLowerCase(), String(vr0.contributor));
  ok(`entry#${nextId} committed_reward == advertised reward`, String(vr0.committed_reward) === String(REWARD), String(vr0.committed_reward));
  const sReserved = await stats();
  RESERVED_BEFORE = BigInt(String(sReserved.reserved_balance));
  ok("reserved_balance incremented at submit", RESERVED_BEFORE >= REWARD, String(sReserved.reserved_balance));

  // Snapshots must be settled already (all prior ops waited for); owner untouched since S0.
  const dOwnerBefore = await balance(OWNER);
  const dContractBefore = await balance(ADDR);

  let settled = false;
  for (let attempt = 1; attempt <= 3 && !settled; attempt++) {
    console.log(`  validate_contribution(${nextId}) attempt ${attempt}/3 — real web + LLM consensus...`);
    await sleep(4000);
    const wVal = parseWrite(cli("validate_contribution", [nextId]));
    console.log(`  write: exec=${wVal.execRes} result=${wVal.resultName} lifecycle=${wVal.statusName}`);
    if (wVal.execRes === "SUCCESS" && ["ACCEPTED", "FINALIZED"].includes(wVal.statusName)) settled = true;
    else await sleep(10000);
  }
  ok("validate settled on-chain", settled, "still UNDETERMINED after 3 tries");

  const vr = await callRetry("get_validation_result", [nextId]);
  console.log(`  vr#${nextId}:`, JSON.stringify({ status: vr.status, score: vr.ai_score, settled_reward: vr.settled_reward, evidence_len: vr.evidence_len }));
  ok("entry ACCEPTED", vr.status === "ACCEPTED", vr.status);
  ok("settled_reward == reward", String(vr.settled_reward) === String(REWARD), String(vr.settled_reward));
  ok("evidence_hash committed on settlement", typeof vr.evidence_hash === "string" && vr.evidence_hash.startsWith("0x"), String(vr.evidence_hash));

  // The transfer lands when the external message finalizes (seconds–minutes
  // after ACCEPTED) — WAIT for the exact expected balances instead of reading now.
  console.log("  waiting for payout to reach the balance layer...");
  await expectBalance("contributor balance +reward EXACT", OWNER, dOwnerBefore + REWARD, 240_000);
  await expectBalance("contract physical -reward EXACT", ADDR, dContractBefore - REWARD, 240_000);
  await expectLedger("ledger after ACCEPTED: reserved released, pool -reward", {
    reserved: RESERVED_BEFORE - REWARD,
    pool: BigInt(String(ledgerBeforeS2.pool_balance)) + ONE / 2n - REWARD,
  });
  C_AFTER_S3 = dContractBefore - REWARD; // verified above — S4 continues from here
}

// ================================================================== S4
section("S4: withdraw() — guards (incl. reserved lock) + real balance movement");
{
  // guard: amount must be > 0 (owner)
  const w0 = parseWrite(cli("withdraw", ["0", OWNER]));
  ok("withdraw(0) rejected", w0.execRes === "ERROR" && /Amount must be > 0/.test(w0.out), w0.execRes);

  // guard: non-owner rejected (fresh local signer, no funds needed — gasless).
  // Amount must be bigint (u256) — a JS string would serialize as str → type error.
  const rNo = await writeAndWait(clientLocal, {
    functionName: "withdraw", args: [10n ** 16n, local.address],
  });
  ok("withdraw by non-owner exec ERROR", rNo.exec === "ERROR", `exec=${rNo.exec} tx=${rNo.hash} msg=${rNo.msg.slice(0, 120)}`);
  if (rNo.msg) ok("non-owner error message says Only owner", /Only owner/.test(rNo.msg), rNo.msg.slice(0, 160));

  // guard: reserved balance is locked — withdraw must never touch it.
  // The next submit reserves REWARD again, so available drops by REWARD.
  const sBeforeLock = await stats();
  const availableNow = BigInt(String(sBeforeLock.available_balance));
  await sleep(4000);
  const wLockSub = parseWrite(cli("submit_contribution", [
    "tech",
    "Reserved-lock withdrawal probe",
    `https://en.wikipedia.org/wiki/Electronic_signature?run=${Date.now()}`,
    "An electronic signature is an electronic manifestation of a person's intent to agree to the terms of a contract or document.",
  ]));
  ok("lock-probe submit SUCCESS", wLockSub.execRes === "SUCCESS", wLockSub.execRes);
  const sLocked = await stats();
  const availLocked = BigInt(String(sLocked.available_balance));
  ok("available drops by reward after reserve", availLocked === availableNow - REWARD, `avail=${sLocked.available_balance}`);
  {
    const wOver = parseWrite(cli("withdraw", [String(availLocked + 1n), OWNER]));
    ok("withdraw above available rejected (reserved funds locked)", wOver.execRes === "ERROR" && /Insufficient available/.test(wOver.out), wOver.execRes);
  }
  // release the lock via the contributor escape path (owner cancels own entry)
  const lockEntryId = Number((await callRetry("get_stats")).total_entries);
  await sleep(4000);
  const wCancel = parseWrite(cli("cancel_pending", [lockEntryId, "lock-probe cleanup"]));
  ok("lock-probe cancel SUCCESS", wCancel.execRes === "SUCCESS", wCancel.execRes);
  await expectLedger("cancel releases the reservation", { reserved: RESERVED_BEFORE - REWARD });

  // happy path: owner withdraws 0.01 GEN to a fresh address that never paid anything.
  const TEN = 10n ** 16n;
  const contractBefore = C_AFTER_S3; // set + verified by the S3 payout waits
  const poolAfterLock = BigInt(String((await stats()).pool_balance));
  const recipient = createAccount().address;
  await sleep(4000);
  const w1 = parseWrite(cli("withdraw", ["10000000000000000", recipient]));
  ok("withdraw(0.01 GEN) exec SUCCESS", w1.execRes === "SUCCESS", w1.execRes);
  console.log(`  waiting for withdraw to settle — contract → ${gen(contractBefore - TEN)} GEN, recipient +0.01...`);
  await expectBalance("contract physical -0.01 GEN exact", ADDR, contractBefore - TEN, 240_000);
  await expectBalance("recipient +0.01 GEN exact", recipient, TEN, 240_000);
  await expectLedger("ledger after withdraw: pool -0.01", {
    pool: poolAfterLock - TEN,
  });
}

// ================================================================== summary
console.log(`\n================ MONEY FLOW: ${passed} passed, ${failed} failed ================`);
if (failed) {
  console.log("Failures:");
  for (const f of failures) console.log("  x " + f);
}
process.exit(failed ? 1 : 0);
