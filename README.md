# Veritasphere — Crowd-sourced Knowledge Database

> **Submit a source, let AI validators verify it.** Users post topic + source-URL summaries; the Intelligent Contract fetches the page itself, runs an LLM adjudication bound to that evidence, and AI validators re-verify independently before consensus settles a GEN reward to the contributor.

[![GenLayer](https://img.shields.io/badge/GenLayer-Studionet-F5A524)](https://studio.genlayer.com/) [![Contract](https://img.shields.io/badge/contract-0x8E4E…3b0A-2DD4BF)](https://explorer-studio.genlayer.com/contracts/0x8E4E6168028BCaCDB9a885Be4B014380371A3b0A)

## 🔴 Live on Studionet

| | |
|---|---|
| **Contract** | [`0x8E4E6168028BCaCDB9a885Be4B014380371A3b0A`](https://explorer-studio.genlayer.com/contracts/0x8E4E6168028BCaCDB9a885Be4B014380371A3b0A) |
| **Network** | GenLayer Studionet (chain `61999`) — gasless, 60 req/min |
| **Test record** | 18/18 direct · 15/15 frontend-binding · 25/25 money-flow (2026-10-19) · 59/60 live E2E + adversarial (2026-10-17) |

## ❓ Why

Crowdsourced knowledge rots: link-spam, fabricated summaries, unverifiable claims. Veritasphere moves verification into consensus — the contract **never trusts the submitted summary**:

- **Fetch, don't trust** — `gl.nondet.web.get` pulls the real page contract-side before any LLM sees it.
- **Bind adjudication to evidence** — the LLM must cite the fetched page (≥2 normalized content tokens shared with the summary) or the round fails closed.
- **Contradiction gate** — irrelevant-but-high-score / relevant-but-low-score verdicts → `LLM_ERROR`, not consensus.
- **Validators re-verify independently** — each validator repeats fetch + prompt; agreement is on the score/class, not on wording.
- **Exact, one-time payouts** — settle guards (`PENDING`-only), contributor attribution from `gl.message.sender_address`, `cancel_pending` escape hatch, owner-funded reward pool.

## ⚙️ How it works

```
submit_contribution(topic, title, url, summary)   → entry PENDING (+20s cooldown)
      ↓ validators fetch url, score with LLM, compare
settle(id) → ACCEPTED (score ≥ 7, agreeing quorum) → exact 0.1 GEN to contributor
           → REJECTED (no reward, entry kept for transparency)
cancel_pending(id) → contributor/owner escape, before settle
```

**Methods (16):** `submit_contribution` · `validate_contribution` · `settle` · `cancel_pending` · `fund_pool` · `set_reward_amount` · views: `get_validation_result` · `get_entry` · `get_all_entries` · `get_accepted_entries` · `get_pending_entries` · `get_topics` · `get_leaderboard` · `get_stats` · `preview_evidence` · `owner`.

## 🗂️ Structure

```
├── contracts/veritasphere.py     # Intelligent Contract (pinned GenVM runner)
├── tests/direct/                 # 18 direct-mode tests (mocked web + LLM), <1s
├── frontend/                     # Next.js 14 + genlayer-js (all pages live)
│   ├── lib/genlayer.ts           # typed contract binding (reads/writes)
│   ├── lib/rpc.ts                # gen_call guard: min-gap queue + TTL cache + 429 backoff
│   └── tests/integration/        # 9 contract↔frontend tests + 6 rpc-guard units
└── requirements.txt
```

## 🚀 Quickstart

### Contract

```bash
pip install -r requirements.txt
genvm-lint check contracts/veritasphere.py   # {"ok":true}, 16 methods
pytest tests/direct/ -q                       # 18 passed, <1s
```

### Frontend

```bash
cd frontend && npm install
cp .env.production .env        # local dev (Vercel uses .env.production as-is)
npm run dev                    # http://localhost:3000 — live contract
```

### Test matrix

| Script | What it proves |
|---|---|
| `npm run lint:genvm` | contract passes the GenVM linter (encoding-safe on Windows) |
| `npm run test:integration` | **real** frontend functions against the **deployed** contract — typed UI shapes, schema parity, write happy-path + duplicate-URL rejection, rpc-guard units (15 tests) |
| `npm run test:money` | **real GEN balance deltas** for every pay path: gasless writes, transfer-in, `fund_pool` msg.value via genlayer-js, settle pays contributor exactly the reward, `withdraw` guards + exact movement (waits out the eventually-consistent balance layer; 25 tests) |
| `npm run test:studionet` | E2E + adversarial suite via CLI (needs `npm i -g genlayer`, active account with GEN): settle pays exactly 0.1 GEN, guards, escape hatches. Expects a **fresh** contract (asserts `total_entries == 0`) |
| `npm run test:all` | lint:genvm + integration |
| `gltest tests/integration --network studionet` | full-consensus pytest suite (real web + LLM; uses the same direct-mode harness) |

## 🚀 Deploy to Vercel

1. Import this repo → **Root Directory = `frontend`** (framework: Next.js auto-detected).
2. Env is baked in via [`frontend/.env.production`](frontend/.env.production) — no dashboard vars needed:

   ```ini
   NEXT_PUBLIC_CONTRACT_ADDRESS=0x8E4E6168028BCaCDB9a885Be4B014380371A3b0A
   NEXT_PUBLIC_RPC_URL=https://studio.genlayer.com/api
   NEXT_PUBLIC_CHAIN=studionet
   ```

3. Deploy. Reads work without a wallet; writes open the EIP-6963 wallet popup (Studionet chain `61999`).

## 🛡️ RPC rate-limit guard

Studionet allows **60 gen_call/min**. Every read/write in `lib/genlayer.ts` goes through `lib/rpc.ts`:

- **min-gap queue** (≥1050 ms apart ≈ 57/min — always under quota)
- **TTL cache + in-flight dedup** (StrictMode double-mount / multi-component / page remount → 1 RPC)
- **exponential backoff** on throttle-shaped errors (429 / rate-limit), never on real contract errors
- **poll discipline** — consensus polling: adaptive 3→10 s cadence; hidden tabs pause; `rpcClear()` after every write

## 📚 References

- [GenLayer Docs](https://docs.genlayer.com) · [GenLayer Skills](https://skills.genlayer.com/)
- Patterns adapted from [ParaNusa](https://github.com/rizqhika29/paranusa) (lifecycle polling, honest-error taxonomy, tx tracking)
