# Veritasphere Frontend

Next.js 14 + Tailwind + TypeScript + genlayer-js (reads work without a wallet;
writes open the EIP-6963 wallet popup).

## Setup
```bash
cd frontend
npm install
cp .env.example .env   # live Studionet values (public — safe to commit)
npm run dev            # http://localhost:3000
```

Vercel: **Root Directory = `frontend`** — env baked in via `.env.production`.

## Scripts
```bash
npm run lint:genvm        # genvm-lint on ../../contracts/veritasphere.py
npm run test:integration  # contract↔frontend tests against deployed studionet (15)
npm run test:studionet    # E2E + adversarial via genlayer CLI (needs npm i -g genlayer)
npm run test:all          # lint:genvm + integration
```

## Structure
- `lib/genlayer.ts` — typed binding: reads (`readStats`, `readAll`, `readValidationResult`, …) + writes (`submitContributionLive`, `validateContributionLive`, `cancelPendingLive`)
- `lib/rpc.ts` — gen_call guard: min-gap queue (≈57 req/min < 60 quota), TTL cache + in-flight dedup, 429 backoff, `rpcClear()` after writes
- `lib/wallet.ts` + `components/WalletConnect.tsx` — EIP-6963 multi-wallet popup
- `components/ui/*` — shadcn-style primitives (imports via `@/components/ui/*`)

## Pages
`/` (Warp hero) → `/how-it-works` → `/explore` → `/submit` → `/validate` → `/entry/[id]` (PENDING poll + Validate/Cancel) → `/leaderboard`

See the [root README](../README.md) for contract details and the full test matrix.
