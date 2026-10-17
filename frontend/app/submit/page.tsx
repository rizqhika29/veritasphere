"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Input, Textarea, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isConfigured, readStats, submitContributionLive } from "@/lib/genlayer";
import { getActiveWallet } from "@/components/WalletConnect";

export default function Submit() {
  const [f, setF] = useState({ topic: "", title: "", source_url: "", summary: "" });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const set = (k: string) => (e: unknown) => setF({ ...f, [k]: (e as { target: { value: string } }).target.value });

  async function onSubmit() {
    if (!f.topic.trim()) { setMsg("topic required"); return; }
    if (!f.title.trim()) { setMsg("title required"); return; }
    if (!f.source_url.startsWith("http")) { setMsg("source_url must start with http(s)://"); return; }
    if (f.summary.length < 20) { setMsg("Summary min 20 chars"); return; }
    if (!isConfigured()) { setMsg("Set NEXT_PUBLIC_CONTRACT_ADDRESS in .env, then retry. Demo id=1."); router.push("/entry/1"); return; }
    const { address, provider } = getActiveWallet();
    if (!address || !provider) { setMsg("Connect wallet dulu via popup kanan atas (pilih MetaMask / Rabby)."); return; }
    setBusy(true);
    setMsg("Reading contract counter...");
    try {
      // entry_id returned by submit_contribution == next counter value.
      const stats = await readStats();
      const nextId = stats.total_entries + 1;
      setMsg(`Submitting (target verification ID #${nextId})...`);
      const r = await submitContributionLive(provider, address, f.topic.trim(), f.title.trim(), f.source_url.trim(), f.summary.trim());
      if (!r.ok) { setMsg(`Submit finalized but execution failed: ${r.status} tx=${r.txId}`); return; }
      setMsg(`Submitted tx=${r.txId} → verification ID #${nextId}. Opening entry...`);
      router.push(`/entry/${nextId}`);
    } catch (e) {
      setMsg(`Submit failed: ${(e as Error).message}`);
    } finally { setBusy(false); }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-14 space-y-4">
      <h1 className="text-4xl font-light italic">Submit contribution</h1>
      <p className="text-white/60 text-sm">Connect wallet (popup kanan atas), isi form, submit. Entry ID diambil dari counter kontrak — bukan list terakhir.</p>
      <Card><div className="space-y-3">
        <Input placeholder="topic (e.g. crypto)" value={f.topic} onChange={set("topic")} />
        <Input placeholder="title" value={f.title} onChange={set("title")} />
        <Input placeholder="https:// source URL (reputable, readable)" value={f.source_url} onChange={set("source_url")} />
        <Textarea rows={4} placeholder="Draft summary min 20 chars" value={f.summary} onChange={set("summary")} />
        <Button onClick={onSubmit} disabled={busy}>{busy ? "Submitting..." : "Submit → returns verification ID"}</Button>
        {msg && <p className="text-cyan-300 text-sm break-all">{msg}</p>}
      </div></Card>
    </div>
  );
}
