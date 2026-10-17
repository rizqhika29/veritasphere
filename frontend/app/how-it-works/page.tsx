import { Card, Badge } from "@/components/ui/card";

const steps = [
  { t: "1. Submit (authenticated)", d: "submit_contribution(topic,title,source_url,summary) stores PENDING, checks duplicate URL, normalizes topic, records sender. Returns entry_id — use it for all next calls." },
  { t: "2. Validate (consensus)", d: "validate_contribution(id) fetches source_url on-chain, LLM scores 0-10 with rubric, validators agree on entry_id+source+topic+reward, relevance match, score ±2, summary bound to evidence. Contradictions (relevant=true/score<=3) force rotation." },
  { t: "3. Settle + escape", d: "ACCEPTED (>=7) emits GEN reward atomically, stores evidence_snippet + settled_reward. One-time guard: ACCEPTED/REJECTED/CANCELLED terminal. cancel_pending(id) by contributor/owner if inconclusive." },
];

export default function HowItWorks() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-14 space-y-5">
      <h1 className="text-4xl font-light italic">How it works</h1>
      <p className="text-white/60">Trustless flow: inputs bound to stored terms, no caller-supplied evidence.</p>
      {steps.map((s) => (
        <Card key={s.t}><Badge tone="cyan">{s.t.split(" ")[0]}</Badge><h3 className="mt-2 text-lg">{s.t}</h3><p className="text-white/60 text-sm mt-1">{s.d}</p></Card>
      ))}
      <Card><h3>Good sources win</h3><p className="text-white/60 text-sm mt-1">Wikipedia, official docs, major news. Spam, paywall-empty, hallucinated summaries (no 2+ keywords from source) are rejected 0-3.</p></Card>
    </div>
  );
}
