# Veritasphere — Crowd-sourced Knowledge Database

> **Submit a source, let AI validators verify it.** Users post topic + source-URL summaries; the Intelligent Contract fetches the page itself, runs an LLM adjudication bound to that evidence, and AI validators re-verify independently before consensus settles a GEN reward to the contributor.

[![GenLayer](https://img.shields.io/badge/GenLayer-Studionet-F5A524)](https://studio.genlayer.com/) [![Contract](https://img.shields.io/badge/contract-0x2C15%E2%80%A6EC8A-2DD4BF)](https://explorer-studio.genlayer.com/contracts/0x2C15F9E7822Aa78c6940Dd4abC246b86849dEC8A)

## 🔴 Live on Studionet

| | |
|---|---|
| **Contract (v2)** | [`0x2C15F9E7822Aa78c6940Dd4abC246b86849dEC8A`](https://explorer-studio.genlayer.com/contracts/0x2C15F9E7822Aa78c6940Dd4abC246b86849dEC8A) |
| **Deploy tx** | `0x49c8e214ccf14411bd9cc487091e5eda53bd633c5f6c5568b843208d0a57b35b` (FINALIZED) |
| **Source SHA256** | `4358394895d2164dbf7341f8a63b8be762fb99a082cc30bebbf91d41e4243f46` (`contracts/veritasphere.py`) |
| **Network** | GenLayer Studionet (chain `61999`) — gasless |
| **Test record** | 45/45 direct · 38/38 money-flow · 74/74 studionet E2E · 15/15 frontend-binding (all live on Studionet, 2026-10-22) |

## ❓ Why

Crowdsourced knowledge rots: link-spam, fabricated summaries, unverifiable claims. Veritasphere moves verification into consensus — the contract **never trusts the submitted summary**:

- **Fetch, don't trust** — `gl.nondet.web.get` pulls the real page contract-side before any LLM sees it.
- **Bind adjudication to evidence** — the LLM must cite the fetched page (≥2 normalized content tokens shared with the summary) or the round fails closed.
- **Claim-level verification** — the LLM returns structured claims with verbatim support quotes; quotes must appear in the fetched page (fail-closed) and ≥2 claims are required.
- **Contradiction gate** — irrelevant-but-high-score / relevant-but-low-score verdicts → `LLM_ERROR`, not consensus.
- **Validators re-verify independently** — each validator repeats fetch + prompt; agreement is exact accept-class + relevance + contributor-accuracy + numeric tolerance (±2) inside the same class (score 7 vs 6 must disagree).
- **Exact, one-time payouts** — settle guards (`PENDING`-only), contributor attribution from `gl.message.sender_address`, `cancel_pending` escape hatch (owner must justify; audit-logged), `appeal_cancellation` re-entry (once).
- **Reward reserved at submit** — pool ledger (`fund_pool` credits; plain transfers are uncounted donations). The advertised reward is committed per-entry at submission; `withdraw` can never touch reserved funds; later `set_reward_amount` changes only future entries.
- **Evidence commitments** — settlement records an FNV-1a-64 hash + length of the fetched page; anyone can re-run `verify_evidence` later to detect source drift (MATCH / CHANGED / UNAVAILABLE).

## ⚙️ How it works

```
submit_contribution(topic, title, url, summary)   → entry PENDING, reward reserved from pool
      ↓ validators fetch url, LLM scores + claims, exact-class consensus
validate(id) → ACCEPTED (relevant + contributor_accurate + score ≥ 7, quorum) → exact committed GEN to contributor
             → REJECTED (no reward, entry kept for transparency, reservation released)
cancel_pending(id, justification) → contributor/owner escape while PENDING (owner justification required + audited)
appeal_cancellation(id) → contributor re-entry after cancel (once; re-reserves funds)
verify_evidence(id) → re-fetch source NOW vs settlement commitment (MATCH/CHANGED/UNAVAILABLE)
```

**Methods (19):** writes: `submit_contribution` · `validate_contribution` · `cancel_pending` · `appeal_cancellation` · `verify_evidence` · `fund_pool` · `set_reward_amount` · `withdraw`. Views: `get_validation_result` · `get_entry` · `get_all_entries` · `get_accepted_entries` · `get_pending_entries` · `get_entries_by_topic` · `get_topics` · `get_leaderboard` · `get_stats` · `get_contributor_stats` · `get_audit` · `owner`.

## 🗂️ Structure

```
├── contracts/veritasphere.py     # Intelligent Contract v2 (pinned GenVM runner)
├── tests/direct/                 # 45 direct-mode tests (mocked web + LLM), <2s
├── tests/integration/            # full-consensus pytest suite (real web + LLM)
├── frontend/                     # Next.js 14 + genlayer-js (all pages live)
│   ├── lib/genlayer.ts           # typed contract binding (reads/writes)
│   ├── lib/rpc.ts                # gen_call guard: min-gap queue + TTL cache + 429 backoff
│   └── tests/integration/        # contract↔frontend tests (v2 paginated shapes)
└── requirements.txt
```

## 🚀 Quickstart

### Contract

```bash
pip install -r requirements.txt
genvm-lint check contracts/veritasphere.py   # 19 methods (11 view, 8 write)
pytest tests/direct/ -q                       # 43 passed, <2s
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
| `pytest tests/direct` | 45 direct-mode tests: reward reservation/withdraw locks, claim gates (formatting-tolerant, content fail-closed), evidence commitments + `verify_evidence`, exact-class consensus helpers, audit trail, appeal guards, pagination |
| `npm run test:integration` | **real** frontend functions against the **deployed** contract — typed UI shapes (v2 paginated dicts), schema parity, write happy-path (waits for FINALIZED, not just leader-exec) + duplicate-URL rejection — **15/15 live (2026-10-22)** |
| `npm run test:money` | **real GEN balance deltas** + ledger reads for every pay path: gasless writes, uncounted plain transfer, `fund_pool` msg.value credits ledger, submit reserves reward, settle pays contributor exactly + ledger releases, `withdraw` guards (incl. reserved lock) + exact movement — **38/38 live (2026-10-22)** |
| `npm run test:studionet` | E2E + adversarial suite via CLI (needs `npm i -g genlayer`): fresh contract, fund_pool, submit/cancel (justification + audit)/validate with real LLM, appeal guards, ledger integrity. Expects `total_entries == 0` — **74/74 live (2026-10-22, fresh deploy [`0x6608…5151F`](https://explorer-studio.genlayer.com/contracts/0x6608d9DB9D3AAB3e7dbb749E8539087c9DF5151F))** |
| `npm run test:all` | lint:genvm + integration |
| `gltest tests/integration --network studionet` | full-consensus pytest suite (real web + LLM; uses the same direct-mode harness) |

## 🚀 Deploy to Vercel

1. Import this repo → **Root Directory = `frontend`** (framework: Next.js auto-detected).
2. Env is baked in via [`frontend/.env.production`](frontend/.env.production) — no dashboard vars needed:

   ```ini
   NEXT_PUBLIC_CONTRACT_ADDRESS=0x2C15F9E7822Aa78c6940Dd4abC246b86849dEC8A
   NEXT_PUBLIC_RPC_URL=https://studio.genlayer.com/api
   NEXT_PUBLIC_CHAIN=studionet
   ```

3. Deploy. Reads work without a wallet; writes open the EIP-6963 wallet popup (Studionet chain `61999`).

## 🛡️ RPC rate-limit guard

Studionet allows **60 gen_call/min**. Every read/write in `lib/genlayer.ts` goes through `lib/rpc.ts`:

- **min-gap queue** (≥1050 ms apart ≈ 57/min — always under quota)
- **TTL cache + in-flight dedup** (StrictMode double-mount / multi-component / page remount → 1 RPC)
- **exponential backoff** on throttle-shaped errors (429 / rate-limit), never on real contract errors
- **poll discipline** — writes wait for `FINALIZED` (not just leader-exec); entry-page settlement poll: 8 s cadence, paused in hidden tabs; `rpcClear()` after every write

## 📚 References

- [GenLayer Docs](https://docs.genlayer.com) · [GenLayer Skills](https://skills.genlayer.com/)
- Patterns adapted from [ParaNusa](https://github.com/rizqhika29/paranusa) (lifecycle polling, honest-error taxonomy, tx tracking)
