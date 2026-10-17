import Link from "next/link";
import { Sparkles } from "lucide-react";
import { WalletConnect } from "./WalletConnect";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-sphere-950/80 backdrop-blur">
      <nav className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2 font-light italic text-xl">
          <Sparkles size={20} className="text-cyan-300" /> Veritasphere
        </Link>
        <div className="flex items-center gap-5 text-sm text-white/80">
          <Link href="/how-it-works" className="hover:text-white hidden md:inline">How it works</Link>
          <Link href="/explore" className="hover:text-white hidden md:inline">Explore</Link>
          <Link href="/submit" className="hover:text-white hidden md:inline">Submit</Link>
          <Link href="/validate" className="hover:text-white hidden md:inline">Validate</Link>
          <Link href="/leaderboard" className="hover:text-white hidden md:inline">Leaderboard</Link>
          <WalletConnect />
        </div>
      </nav>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="border-t border-white/10 mt-16">
      <div className="max-w-6xl mx-auto px-6 py-8 text-sm text-white/50 flex justify-between">
        <span>Veritasphere — crowd-sourced knowledge, AI-validated on GenLayer.</span>
        <span>Threshold 7 · Tolerance ±2</span>
      </div>
    </footer>
  );
}
