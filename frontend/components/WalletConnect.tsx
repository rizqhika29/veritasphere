"use client";
import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { discoverWallets, connectProvider, type DiscoveredWallet } from "@/lib/wallet";

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<DiscoveredWallet["provider"] | null>(null);
  const [open, setOpen] = useState(false);
  const [wallets, setWallets] = useState<DiscoveredWallet[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("verita-wallet") : null;
    if (saved) setAddress(saved);
  }, []);

  async function openModal() {
    setOpen(true);
    setLoading(true);
    const list = await discoverWallets(700);
    setWallets(list);
    setLoading(false);
  }

  async function select(w: DiscoveredWallet) {
    try {
      const addr = await connectProvider(w.provider);
      setAddress(addr);
      setProvider(w.provider);
      localStorage.setItem("verita-wallet", addr);
      localStorage.setItem("verita-wallet-name", w.info.name);
      setOpen(false);
    } catch (e) {
      console.error(e);
    }
  }

  function disconnect() {
    setAddress(null);
    setProvider(null);
    localStorage.removeItem("verita-wallet");
  }

  return { address, provider, open, setOpen, wallets, loading, openModal, select, disconnect };
}

export function WalletConnect() {
  const w = useWallet();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // share via window for pages (simple, no extra dep)
  useEffect(() => {
    (window as unknown as { __veritaWallet?: unknown }).__veritaWallet = { address: w.address, provider: w.provider };
  }, [w.address, w.provider]);
  if (!mounted) return null;

  return (
    <>
      {w.address ? (
        <button onClick={w.disconnect} className="px-4 py-2 rounded-full bg-emerald-400/20 border border-emerald-300/30 text-emerald-200 text-sm">
          {w.address.slice(0, 6)}...{w.address.slice(-4)} ✕
        </button>
      ) : (
        <button onClick={w.openModal} className="px-4 py-2 rounded-full bg-white text-slate-900 text-sm font-medium flex items-center gap-2 hover:scale-105 transition">
          <Wallet size={16} /> Connect
        </button>
      )}
      {w.open && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6" onClick={() => w.setOpen(false)}>
          <div
            className="w-full max-w-sm rounded-2xl border border-white/15 bg-slate-900 p-6 space-y-4 shadow-[0_20px_60px_rgba(0,0,0,0.6)] translate-y-[8vh] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg">Choose wallet</h3>
            <p className="text-xs text-white/50">EIP-6963 discovery — pick one explicitly. No auto-inject fighting between MetaMask and Rabby.</p>
            {w.loading && <p className="text-sm text-white/60">Discovering wallets...</p>}
            {!w.loading && w.wallets.length === 0 && (
              <p className="text-sm text-white/60">No EVM wallet found. Install MetaMask or Rabby, then retry.</p>
            )}
            {w.wallets.map((it) => (
              <button key={it.info.uuid} onClick={() => w.select(it)} className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:border-cyan-300/50 transition text-left">
                {it.info.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.info.icon} alt="" className="w-6 h-6 rounded-full" />
                ) : (
                  <Wallet size={18} className="text-cyan-300" />
                )}
                <span className="text-sm">{it.info.name}</span>
                <span className="ml-auto text-[10px] text-white/40">{it.info.rdns}</span>
              </button>
            ))}
            <button onClick={() => w.setOpen(false)} className="text-xs text-white/50 hover:text-white">Cancel</button>
          </div>
        </div>
      )}
    </>
  );
}

export function getActiveWallet(): { address: string | null; provider: DiscoveredWallet["provider"] | null } {
  if (typeof window === "undefined") return { address: null, provider: null };
  const s = (window as unknown as { __veritaWallet?: { address: string | null; provider: DiscoveredWallet["provider"] | null } }).__veritaWallet;
  return s ?? { address: null, provider: null };
}
