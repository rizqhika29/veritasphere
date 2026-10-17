"use client";
import { useEffect, useState } from "react";
import { Card, Badge } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { isConfigured, readLeaderboard, type LeaderRow } from "@/lib/genlayer";

const ROWS: LeaderRow[] = [
  { contributor: "0xabc...1", submitted: 5, accepted: 4 },
  { contributor: "0xdef...2", submitted: 3, accepted: 1 },
];

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderRow[]>(ROWS);
  const [live, setLive] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    if (!isConfigured()) return;
    try {
      const lb = await readLeaderboard(20);
      setRows(lb);
      setLive(true);
      setErr("");
    } catch (e) { setErr((e as Error).message); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="max-w-4xl mx-auto px-6 py-14 space-y-4">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-light italic">Leaderboard</h1>
          <p className="text-white/60 text-sm">{live ? "Live from get_leaderboard(20), sorted by accepted." : "Mock — set NEXT_PUBLIC_CONTRACT_ADDRESS for live."}</p>
        </div>
        <GhostButton onClick={() => { setLive(false); load(); }}>↻ Refresh</GhostButton>
      </div>
      {err && <p className="text-red-300 text-sm break-all">{err}</p>}
      <Card className="grid grid-cols-12 text-xs text-white/45 px-5">
        <span className="col-span-1">#</span><span className="col-span-7">Contributor</span><span className="col-span-4 text-right">Submitted / Accepted</span>
      </Card>
      {rows.length === 0 && <p className="text-white/50 text-sm">Belum ada contributor.</p>}
      {rows.map((r, i) => (
        <Card key={r.contributor} className="grid grid-cols-12 items-center text-sm">
          <span className="col-span-1 text-cyan-300 font-medium">{i + 1}</span>
          <span className="col-span-7 break-all">{r.contributor}</span>
          <span className="col-span-4 text-right flex justify-end gap-2">
            <Badge tone="slate">sub {r.submitted}</Badge>
            <Badge tone="green">acc {r.accepted}</Badge>
          </span>
        </Card>
      ))}
    </div>
  );
}
