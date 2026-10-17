"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/components/ui/card";
import { Button, GhostButton } from "@/components/ui/button";
import { isConfigured, readPending, validateContributionLive, cancelPendingLive, type PendingCard } from "@/lib/genlayer";
import { getActiveWallet } from "@/components/WalletConnect";

export default function Validate() {
  const [log, setLog] = useState("Loading pending...");
  const [pend, setPend] = useState<PendingCard[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!isConfigured()) { setLog("Set NEXT_PUBLIC_CONTRACT_ADDRESS to load live pending queue."); setLoaded(true); return; }
    try {
      const p = await readPending();
      setPend(p);
      setLog(p.length ? `Found ${p.length} pending entr${p.length === 1 ? "y" : "ies"}.` : "No pending entries.");
    } catch (e) { setLog(`Load failed: ${(e as Error).message}`); }
    finally { setLoaded(true); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function act(kind: "validate" | "cancel", id: number) {
    const { address, provider } = getActiveWallet();
    if (!address || !provider) { setLog("Connect wallet dulu via popup (pilih satu, jangan dua-duanya)."); return; }
    setBusy(true);
    try {
      const r = kind === "validate"
        ? await validateContributionLive(provider, address, id)
        : await cancelPendingLive(provider, address, id);
      setLog(`${kind}(${id}) → ok=${r.ok} ${r.status} tx=${r.txId}. Opening result...`);
      await load();
    } catch (e) { setLog(`${kind} failed: ${(e as Error).message}`); }
    finally { setBusy(false); }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-14 space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-light italic">Validate queue</h1>
          <p className="text-white/60 text-sm">get_pending_entries → AI consensus (validate) / escape path (cancel).</p>
        </div>
        <GhostButton onClick={() => { setLoaded(false); load(); }}>↻ Refresh</GhostButton>
      </div>

      {!loaded && <p className="text-white/50 text-sm">Loading...</p>}
      {loaded && pend.length === 0 && (
        <Card>
          <Badge tone="slate">EMPTY QUEUE</Badge>
          <p className="mt-2 text-white/60 text-sm">Tidak ada entry PENDING. Submit satu dulu, atau Refresh setelah tx masuk antrean.</p>
          <Link href="/submit" className="inline-block mt-3 text-cyan-300 text-sm">Go to submit →</Link>
        </Card>
      )}

      {pend.map((it) => (
        <Card key={it.id}>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge tone="yellow">PENDING #{it.id}</Badge>
            <span className="text-xs text-white/45">{it.topic}</span>
          </div>
          <h3 className="mt-2">{it.title}</h3>
          <p className="text-white/50 text-xs break-all mt-1">{it.source_url}</p>
          <p className="text-white/40 text-xs break-all">contributor {it.contributor}</p>
          <div className="flex gap-3 mt-4">
            <Button disabled={busy} onClick={() => act("validate", it.id)}>{busy ? "Working..." : "Validate (AI consensus)"}</Button>
            <GhostButton disabled={busy} onClick={() => act("cancel", it.id)}>Cancel</GhostButton>
            <Link href={`/entry/${it.id}`}><GhostButton>View →</GhostButton></Link>
          </div>
        </Card>
      ))}
      <p className="text-cyan-300 text-sm break-all">{log}</p>
    </div>
  );
}
