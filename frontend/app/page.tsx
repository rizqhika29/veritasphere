"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ShieldCheck, Coins } from "lucide-react";
import VeritasphereNewsletter from "@/components/ui/veritasphere-newsletter";
import { Card, Badge } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { isConfigured, readStats, type Stats } from "@/lib/genlayer";

export default function Home() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!isConfigured()) return;
    readStats().then(setStats).catch(() => setStats(null));
  }, []);

  return (
    <div>
      <VeritasphereNewsletter />
      <section className="max-w-6xl mx-auto px-6 py-14 grid md:grid-cols-3 gap-5">
        <Card>
          <BookOpen className="text-cyan-300 mb-3" />
          <h3 className="text-lg mb-1">Submit knowledge</h3>
          <p className="text-white/60 text-sm">Post topic, title, source URL + draft. Contract returns your verification ID.</p>
        </Card>
        <Card>
          <ShieldCheck className="text-cyan-300 mb-3" />
          <h3 className="text-lg mb-1">AI validators verify</h3>
          <p className="text-white/60 text-sm">Fetch source on-chain, score 0-10, tolerance ±2, threshold 7.</p>
        </Card>
        <Card>
          <Coins className="text-cyan-300 mb-3" />
          <h3 className="text-lg mb-1">Earn GEN</h3>
          <p className="text-white/60 text-sm">Accepted entries settle reward atomically. Cancel if stuck.</p>
        </Card>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-14 flex gap-4 flex-wrap">
        <Link href="/explore"><GhostButton>Explore verified base</GhostButton></Link>
        <Link href="/how-it-works"><GhostButton>How it works</GhostButton></Link>
        <Link href="/submit"><GhostButton>Submit contribution →</GhostButton></Link>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        <Card>
          <div className="flex items-center gap-3 flex-wrap">
            <Badge tone={stats ? "green" : "slate"}>{stats ? "LIVE CONSENSUS" : "CONTRACT NOT CONFIGURED"}</Badge>
            <span className="text-xs text-white/40">{stats?.name ?? "Veritasphere"}</span>
          </div>
          {stats ? (
            <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
              <div><p className="text-3xl font-light">{stats.total_entries}</p><p className="text-white/50 text-xs mt-1">entries</p></div>
              <div><p className="text-3xl font-light">{stats.topics.length}</p><p className="text-white/50 text-xs mt-1">topics</p></div>
              <div className="col-span-2"><p className="text-3xl font-light break-all">{stats.reward_amount}</p><p className="text-white/50 text-xs mt-1">reward per accepted entry</p></div>
            </div>
          ) : (
            <p className="mt-3 text-white/60 text-sm">Set <code>NEXT_PUBLIC_CONTRACT_ADDRESS</code> di <code>frontend/.env</code> (dan <code>NEXT_PUBLIC_CHAIN</code>) untuk live stats + submit/validate.</p>
          )}
          {stats && stats.topics.length > 0 && (
            <p className="mt-4 text-white/50 text-xs">topics: {stats.topics.join(" · ")}</p>
          )}
        </Card>
      </section>
    </div>
  );
}
