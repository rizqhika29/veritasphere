"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/components/ui/card";
import { Button, GhostButton } from "@/components/ui/button";
import {
  isConfigured, readStats, readValidationResult,
  validateContributionLive, cancelPendingLive, appealCancellationLive,
  type ValidationResult,
} from "@/lib/genlayer";
import { getActiveWallet } from "@/components/WalletConnect";

export default function Entry({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  const [v, setV] = useState<ValidationResult | null>(null);
  const [err, setErr] = useState("");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState(false);
  const [justification, setJustification] = useState("");

  const load = useCallback(async () => {
    if (!isConfigured()) return;
    // Sanitize id first — get_validation_result(NaN/0) always fails at the RPC
    // (genlayer-js logs "GenLayer RPC error (gen_call)" before throwing).
    if (!Number.isInteger(id) || id < 1) {
      setErr(`Entry ID tidak valid: ${params.id}`);
      return;
    }
    try {
      // Existence check via get_stats — never raises for a valid contract,
      // so a not-yet-created id shows a clean UI message instead of an RPC error.
      const stats = await readStats();
      if (id > stats.total_entries) {
        setErr(`Entry #${id} belum ada — total saat ini ${stats.total_entries}.`);
        return;
      }
      setV(await readValidationResult(id));
      setErr("");
    } catch (e) { setErr((e as Error).message); }
  }, [id, params.id]);

  useEffect(() => { load(); }, [load]);

  // PENDING → poll settlement (consensus can take a minute+).
  // Hidden tabs skip ticks (reduced background gen_call; resumes on focus).
  useEffect(() => {
    if (v?.status !== "PENDING" || !isConfigured()) return;
    const t = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      load();
    }, 8000);
    return () => clearInterval(t);
  }, [v?.status, load]);

  async function act(kind: "validate" | "cancel" | "appeal") {
    const { address, provider } = getActiveWallet();
    if (!address || !provider) { setLog("Connect wallet dulu via popup kanan atas."); return; }
    setBusy(true);
    try {
      const r = kind === "validate"
        ? await validateContributionLive(provider, address, id)
        : kind === "cancel"
          // owner must supply a justification; contributor (non-owner) may pass ""
          ? await cancelPendingLive(provider, address, id, justification)
          // appeal requires a recorded reason (min 10 chars) from the contributor
          : await appealCancellationLive(provider, address, id, justification);
      setLog(`${kind}(${id}) → ok=${r.ok} ${r.status} tx=${r.txId}`);
      await load();
    } catch (e) { setLog(`${kind} failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  const live = isConfigured();
  const d = v;
  const tone = d?.status === "ACCEPTED" ? "green" : d?.status === "PENDING" ? "yellow" : d?.status === "REJECTED" ? "red" : "slate";

  return (
    <div className="max-w-3xl mx-auto px-6 py-14 space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <h1 className="text-4xl font-light italic">Entry #{id}</h1>
        <GhostButton onClick={load}>↻ Refresh</GhostButton>
      </div>
      <p className="text-white/60 text-sm">
        {!live && "Set NEXT_PUBLIC_CONTRACT_ADDRESS (frontend/.env) untuk live get_validation_result."}
        {live && d?.status === "PENDING" && "Live · PENDING — polling tiap 8 detik sampai consensus settle."}
        {live && d && d.status !== "PENDING" && "Live from get_validation_result."}
      </p>
      {err && <p className="text-red-300 text-sm break-all">{err}</p>}
      {!d && !err && live && <p className="text-white/50 text-sm">Loading...</p>}

      {d && (
        <>
          <Card>
            <div className="flex items-center gap-3 flex-wrap">
              <Badge tone={tone}>{d.status} · score {d.ai_score}</Badge>
              <Badge tone="cyan">threshold {d.threshold}</Badge>
              <span className="text-xs text-white/45">{d.topic}</span>
            </div>
            <h2 className="text-xl mt-3">{d.title}</h2>
            <p className="text-white/60 text-sm mt-2 break-all">Source (creator-supplied, fetched on-chain): {d.source_url}</p>
            <p className="text-white/60 text-sm break-all">Contributor: {d.contributor}</p>

            {d.status === "PENDING" && live && (
              <div className="mt-4 space-y-3">
                <input
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white/80 placeholder:text-white/30"
                  placeholder="Justification for cancel (required if you are the contract owner)"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                />
                <div className="flex gap-3">
                  <Button disabled={busy} onClick={() => act("validate")}>{busy ? "Working..." : "Validate (AI consensus)"}</Button>
                  <GhostButton disabled={busy} onClick={() => act("cancel")}>Cancel</GhostButton>
                </div>
              </div>
            )}
            {d.status === "CANCELLED" && live && (
              <div className="mt-4 space-y-3">
                <input
                  className="w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs text-white/80 placeholder:text-white/30"
                  placeholder="Appeal reason (min 10 chars, recorded on-chain)"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  disabled={d.appeal_count > 0}
                />
                <GhostButton disabled={busy || d.appeal_count > 0} onClick={() => act("appeal")}>
                  {busy ? "Working..." : d.appeal_count > 0 ? "Appeal already used" : "Appeal cancellation (re-enter queue)"}
                </GhostButton>
              </div>
            )}
            {log && <p className="text-cyan-300 text-xs break-all mt-3">{log}</p>}

            <div className="mt-5 pt-4 border-t border-white/10 space-y-2 text-sm">
              <p><span className="text-white/50">AI summary:</span> {d.ai_summary || <span className="text-white/30">— (belum divalidasi)</span>}</p>
              <p><span className="text-white/50">AI reason (display-only):</span> {d.ai_reason || <span className="text-white/30">—</span>}</p>
              <p><span className="text-white/50">Evidence snippet:</span> {d.evidence_snippet || <span className="text-white/30">—</span>}</p>
              {d.evidence_hash && (
                <p className="break-all"><span className="text-white/50">Evidence commitment:</span> {d.evidence_hash} <span className="text-white/30">({d.evidence_len} chars{d.evidence_truncated ? ", truncated" : ""})</span></p>
              )}
              <p><span className="text-white/50">Committed reward (wei):</span> {d.committed_reward}</p>
              <p><span className="text-white/50">Settled reward:</span> {d.settled_reward}</p>
            </div>
          </Card>
          <p className="text-white/40 text-xs">read: get_validation_result({id}) · write: validate_contribution / cancel_pending</p>
        </>
      )}
      <div className="pt-2"><Link href="/explore" className="text-cyan-300 text-sm">← Back to explore</Link></div>
    </div>
  );
}
