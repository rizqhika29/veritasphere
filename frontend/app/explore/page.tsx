"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Input, Card, Badge } from "@/components/ui/card";
import { GhostButton } from "@/components/ui/button";
import { isConfigured, readAll, readTopics, type EntryCard } from "@/lib/genlayer";

const MOCK: EntryCard[] = [
  { id: 1, topic: "crypto", title: "What is Bitcoin?", status: "ACCEPTED", score: 9 },
  { id: 2, topic: "ai", title: "GenLayer ideas", status: "PENDING", score: 0 },
];

export default function Explore() {
  const [q, setQ] = useState("");
  const [topic, setTopic] = useState("");
  const [live, setLive] = useState<EntryCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [topics, setTopics] = useState<string[]>([]);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      if (!isConfigured()) return;
      try {
        const [all, tps] = await Promise.all([readAll(1, 50), readTopics()]);
        setLive(all.entries);
        setTotal(all.total);
        setTopics(tps);
      } catch (e) { setErr((e as Error).message); }
    })();
  }, []);

  const list = useMemo(() => {
    const src = live ?? MOCK;
    return src.filter((e) => {
      if (topic && e.topic !== topic) return false;
      if (!q) return true;
      const s = q.toLowerCase();
      return e.topic.toLowerCase().includes(s) || e.title.toLowerCase().includes(s);
    });
  }, [live, q, topic]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-14 space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-4xl font-light italic">Explore base</h1>
          <p className="text-white/60 text-sm">
            {live ? `Live · ${total} total entries on-chain.` : "Mock preview — set NEXT_PUBLIC_CONTRACT_ADDRESS for live."}
          </p>
        </div>
        <Link href="/submit"><GhostButton>Submit contribution →</GhostButton></Link>
      </div>
      {err && <p className="text-red-300 text-sm break-all">{err}</p>}
      <Input placeholder="Filter by topic or title..." value={q} onChange={(e) => setQ(e.target.value)} />
      {topics.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <GhostButton onClick={() => setTopic("")} className={topic === "" ? "border-cyan-300/60 text-cyan-200" : ""}>all</GhostButton>
          {topics.map((t) => (
            <GhostButton key={t} onClick={() => setTopic(t)} className={topic === t ? "border-cyan-300/60 text-cyan-200" : ""}>{t}</GhostButton>
          ))}
        </div>
      )}
      {list.length === 0 && <p className="text-white/50 text-sm">No entries match.</p>}
      <div className="grid md:grid-cols-2 gap-4">
        {list.map((e) => (
          <Card key={e.id}>
            <Badge tone={e.status === "ACCEPTED" ? "green" : e.status === "PENDING" ? "yellow" : "red"}>
              {e.status} · score {e.score}
            </Badge>
            <h3 className="mt-2">{e.title}</h3>
            <p className="text-white/50 text-sm">#{e.id} · {e.topic}</p>
            <Link href={`/entry/${e.id}`} className="text-cyan-300 text-sm">Open validation →</Link>
          </Card>
        ))}
      </div>
    </div>
  );
}
