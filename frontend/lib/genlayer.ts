// Central binding for Veritasphere Intelligent Contract (genlayer-js v1.1.8 live).
// Reads work without wallet. Writes need EIP-6963 provider from WalletConnect popup.

import { createClient } from "genlayer-js";
import { localnet, studionet, testnetAsimov, testnetBradbury } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";
import { rpcRead, rpcGate, rpcClear } from "./rpc";

export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ?? "") as `0x${string}` | "";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "";
const CHAIN_NAME = process.env.NEXT_PUBLIC_CHAIN ?? "studionet";

function getChain() {
  if (CHAIN_NAME === "localnet") return localnet;
  if (CHAIN_NAME === "testnetAsimov" || CHAIN_NAME === "asimov") return testnetAsimov;
  if (CHAIN_NAME === "testnetBradbury" || CHAIN_NAME === "bradbury") return testnetBradbury;
  return studionet;
}

// Single shared read client — createClient() is local-only (no RPC), and a
// shared instance keeps one connection path for the whole app.
let sharedReadClient: ReturnType<typeof createClient> | null = null;
function getReadClient() {
  if (!sharedReadClient) {
    sharedReadClient = RPC_URL
      ? createClient({ chain: getChain(), endpoint: RPC_URL })
      : createClient({ chain: getChain() });
  }
  return sharedReadClient;
}

export function isConfigured() {
  return !!CONTRACT_ADDRESS && CONTRACT_ADDRESS !== ("0xYOUR_CONTRACT_ADDRESS" as string);
}

// SDK may return bigint for u32/u256 fields — normalize recursively for UI/JSON.
export function dec<T>(v: T): T {
  if (typeof v === "bigint") return (Number(v) <= Number.MAX_SAFE_INTEGER ? Number(v) : v.toString()) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => dec(x)) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = dec(x);
    return out as unknown as T;
  }
  return v;
}

export type ValidationResult = {
  id: number; status: string; ai_score: number; ai_summary: string;
  ai_reason: string; accepted: boolean; threshold: number;
  source_url: string; topic: string; title: string;
  contributor: string; evidence_snippet: string; settled_reward: string;
  committed_reward: string; evidence_hash: string; evidence_len: number;
  evidence_truncated: boolean; appeal_count: number;
};

// ---- reads (no wallet) — all through rpcRead: min-gap queue, TTL cache,
// in-flight dedup, 429 backoff (see lib/rpc.ts). TTLs are short (5–15s) so
// the UI stays fresh while idle navigation/bursts cost near-zero RPC.
export async function readValidationResult(id: number): Promise<ValidationResult> {
  const r = await rpcRead(`get_validation_result:${id}`, 5000, () =>
    getReadClient().readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: "get_validation_result",
      args: [id],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })
  );
  return dec(r) as unknown as ValidationResult;
}

export type EntryCard = {
  id: number; topic: string; title: string; status: string; score: number;
};

export async function readEntry(id: number) {
  const r = await rpcRead(`get_entry:${id}`, 10000, () =>
    getReadClient().readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: "get_entry",
      args: [id],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })
  );
  return dec(r);
}

export async function readAccepted(
  topic: string, limit: number,
  offset: number = 0
): Promise<{ total: number; entries: (EntryCard & { source_url: string; contributor: string })[] }> {
  const r = await rpcRead(`get_accepted_entries:${topic}:${offset}:${limit}`, 10000, () =>
    getReadClient().readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: "get_accepted_entries",
      args: [topic, offset, limit],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })
  );
  return dec(r) as { total: number; entries: (EntryCard & { source_url: string; contributor: string })[] };
}

export async function readAll(offset: number, limit: number): Promise<{ total: number; entries: EntryCard[] }> {
  const r = await rpcRead(`get_all_entries:${offset}:${limit}`, 10000, () =>
    getReadClient().readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: "get_all_entries",
      args: [offset, limit],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })
  );
  return dec(r) as { total: number; entries: EntryCard[] };
}

export type PendingCard = { id: number; topic: string; title: string; source_url: string; contributor: string };

export async function readPending(offset: number = 0, limit: number = 20): Promise<{ total: number; entries: PendingCard[] }> {
  const r = await rpcRead(`get_pending_entries:${offset}:${limit}`, 8000, () =>
    getReadClient().readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: "get_pending_entries",
      args: [offset, limit],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })
  );
  return dec(r) as { total: number; entries: PendingCard[] };
}

export type Stats = {
  name: string; total_entries: number; topics: string[]; reward_amount: string;
  pool_balance: string; reserved_balance: string; available_balance: string;
  pending_count: number;
};

export async function readStats(): Promise<Stats> {
  const r = await rpcRead("get_stats", 5000, () =>
    getReadClient().readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: "get_stats",
      args: [],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })
  );
  return dec(r) as Stats;
}

export async function readTopics(): Promise<string[]> {
  const r = await rpcRead("get_topics", 10000, () =>
    getReadClient().readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: "get_topics",
      args: [],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })
  );
  return dec(r) as unknown as string[];
}

export type LeaderRow = { contributor: string; submitted: number; accepted: number };

export async function readLeaderboard(limit: number = 20, offset: number = 0): Promise<{ total: number; entries: LeaderRow[] }> {
  const r = await rpcRead(`get_leaderboard:${offset}:${limit}`, 15000, () =>
    getReadClient().readContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName: "get_leaderboard",
      args: [offset, limit],
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
    })
  );
  return dec(r) as { total: number; entries: LeaderRow[] };
}

// ---- writes (need wallet provider from popup, v1.1.8 API: no fee estimation) ----
// Issue 6b: wait for TRUE finalization. leader_receipt.exec can be SUCCESS
// within ~60s while consensus is still open (validators can still disagree).
// The user-visible "done" signal must be statusName === FINALIZED (proven on
// studionet: deploy tx reached FINALIZED with timestamp_awaiting_finalization).
const FINAL_STATES = new Set(["FINALIZED", "REJECTED", "FAILED", "UNDETERMINED"]);
async function waitForFinalized(
  // method syntax → bivariant params, matches SDK's branded Hash type
  client: { getTransaction(args: { hash: `0x${string}` }): Promise<unknown> },
  hash: `0x${string}`
): Promise<{ exec: string; statusName: string }> {
  let exec = "";
  let statusName = "";
  // Adaptive cadence up to ~12 min total: 5s,5s,8s,10s,12s,15s then 20s.
  // FINALIZED typically lands in 1–5 min on studionet; REJECTED/FAILED are
  // terminal early-stops (no point burning the full budget).
  const cadence = [5000, 5000, 8000, 10000, 12000, 15000];
  for (let i = 0; i < 48; i++) {
    const tx = (await rpcGate(() => client.getTransaction({ hash }))) as {
      statusName?: string;
      consensus_data?: { leader_receipt?: { execution_result?: string }[] };
    };
    statusName = tx.statusName ?? "";
    exec = tx.consensus_data?.leader_receipt?.[0]?.execution_result ?? "";
    if (FINAL_STATES.has(statusName)) return { exec, statusName };
    await new Promise((r) => setTimeout(r, cadence[i] ?? 20000));
  }
  // Budget exhausted — surface whatever partial state we have; the caller
  // treats a non-FINALIZED status as ok=false so the UI never overclaims.
  return { exec, statusName };
}

// `provider` accepts two shapes:
//  - EIP-1193 provider object from the EIP-6963 popup (production browser path)
//  - viem local account from createAccount() (integration tests — signs locally)
async function writeWithWallet(
  provider: unknown,
  walletAddress: string,
  functionName: string,
  args: unknown[]
): Promise<{ txId: string; ok: boolean; status: string }> {
  const base = RPC_URL ? { chain: getChain(), endpoint: RPC_URL } : { chain: getChain() };
  const isLocal =
    !!provider && typeof provider === "object" && (provider as { type?: string }).type === "local";
  const client = createClient({
    ...base,
    ...(isLocal
      ? { account: provider as never }
      : { account: walletAddress as `0x${string}`, provider: provider as never }),
  });
  const txId = (await rpcGate(() =>
    client.writeContract({
      address: CONTRACT_ADDRESS as `0x${string}`,
      functionName,
      args: args as never[],
      value: 0n,
    })
  )) as unknown as string;
  // Poll until FINALIZED (not just leader-exec): consensus can still flip
  // after the leader succeeds. ok = FINALIZED && exec SUCCESS — never
  // overclaim on a still-open consensus window.
  // Why not waitForTransactionReceipt: txExecutionResultName is never populated
  // by getTransaction in genlayer-js 1.1.8, and the SDK default retries time
  // out before FINALIZED on studionet.
  const finality = await waitForFinalized(client, txId as `0x${string}`);
  const ok = finality.statusName === "FINALIZED" && finality.exec === "SUCCESS";
  // State may have changed — drop cached reads so pages refetch fresh data.
  rpcClear();
  return { txId, ok, status: `${finality.statusName}/${finality.exec || "pending"}` };
}

export async function submitContributionLive(
  provider: unknown, walletAddress: string,
  topic: string, title: string, source_url: string, summary: string
) {
  return writeWithWallet(provider, walletAddress, "submit_contribution", [topic, title, source_url, summary]);
}

export async function validateContributionLive(provider: unknown, walletAddress: string, id: number) {
  return writeWithWallet(provider, walletAddress, "validate_contribution", [id]);
}

export async function cancelPendingLive(provider: unknown, walletAddress: string, id: number, justification: string) {
  return writeWithWallet(provider, walletAddress, "cancel_pending", [id, justification]);
}

export async function appealCancellationLive(provider: unknown, walletAddress: string, id: number, reason: string) {
  return writeWithWallet(provider, walletAddress, "appeal_cancellation", [id, reason]);
}

export async function withdrawLive(provider: unknown, walletAddress: string, amountWei: string, to: string) {
  return writeWithWallet(provider, walletAddress, "withdraw", [amountWei, to]);
}
