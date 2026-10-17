import Link from "next/link";

// Hero text only — background is now global (SphereBackground in layout).
// Email notify card removed per request. Text boosted for readability.
export default function VeritasphereNewsletter() {
  return (
    <section className="relative z-10 min-h-[82vh] flex items-center justify-center px-8">
      <div className="max-w-3xl w-full text-center space-y-7">
        <p className="inline-block text-cyan-200 tracking-[0.3em] text-[11px] font-medium px-4 py-2 rounded-full border border-white/20 bg-black/40 backdrop-blur-md shadow-lg">
          SPHERE OF VERIFIED TRUTH
        </p>
        <h1 className="text-white text-6xl md:text-7xl font-light italic drop-shadow-[0_4px_24px_rgba(0,0,0,0.8)] [text-shadow:0_2px_30px_rgba(0,0,0,0.9)]">
          Veritasphere
        </h1>
        <p className="text-white text-lg md:text-xl font-light leading-relaxed drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)] [text-shadow:0_1px_16px_rgba(0,0,0,0.9)]">
          Submit knowledge. AI validators fetch the source,
          <br className="hidden md:block" /> score it, and settle rewards on-chain.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
          <Link href="/explore" className="px-6 py-3 rounded-full bg-white text-slate-900 font-medium hover:scale-105 transition shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
            Explore verified base
          </Link>
          <Link href="/submit" className="px-6 py-3 rounded-full border border-white/30 bg-black/40 backdrop-blur-md text-white hover:border-white/70 transition shadow-[0_8px_30px_rgba(0,0,0,0.5)]">
            Submit contribution →
          </Link>
        </div>
        <p className="text-white/70 text-xs tracking-wide drop-shadow-[0_1px_8px_rgba(0,0,0,0.9)]">
          Threshold 7 · Tolerance ±2 · Evidence-bound consensus
        </p>
      </div>
    </section>
  );
}
