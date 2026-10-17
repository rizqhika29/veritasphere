// EIP-6963 multi-wallet discovery — no MetaMask vs Rabby fighting.
// Each wallet announces itself; user picks one explicitly from popup.
// We never touch window.ethereum directly until user selects.

export type EIP1193Provider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  on?: (event: string, cb: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, cb: (...args: unknown[]) => void) => void;
};

export type DiscoveredWallet = {
  info: { uuid: string; name: string; icon: string; rdns: string };
  provider: EIP1193Provider;
};

declare global {
  interface Window {
    ethereum?: EIP1193Provider & { providers?: EIP1193Provider[] };
  }
}

export function discoverWallets(timeoutMs = 600): Promise<DiscoveredWallet[]> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") { resolve([]); return; }
    const found = new Map<string, DiscoveredWallet>();
    const onAnnounce = (event: Event) => {
      const e = event as CustomEvent;
      const { info, provider } = e.detail as DiscoveredWallet;
      if (info?.uuid && !found.has(info.uuid)) found.set(info.uuid, { info, provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    // Fallback: legacy injected (single) — only if no 6963 found
    setTimeout(() => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
      if (found.size === 0 && window.ethereum) {
        const eth = window.ethereum as EIP1193Provider & { isMetaMask?: boolean; isRabby?: boolean };
        // If multiple providers injected (Coinbase pattern), expose each
        const arr = (eth as { providers?: EIP1193Provider[] }).providers;
        if (Array.isArray(arr) && arr.length > 0) {
          arr.forEach((p, i) => {
            found.set(`legacy-${i}`, {
              info: { uuid: `legacy-${i}`, name: `Injected wallet ${i + 1}`, icon: "", rdns: "" },
              provider: p,
            });
          });
        } else {
          found.set("legacy-injected", {
            info: { uuid: "legacy-injected", name: eth.isRabby ? "Rabby (legacy)" : eth.isMetaMask ? "MetaMask (legacy)" : "Injected wallet", icon: "", rdns: "" },
            provider: eth,
          });
        }
      }
      resolve(Array.from(found.values()));
    }, timeoutMs);
  });
}

export async function connectProvider(p: EIP1193Provider): Promise<string> {
  const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) throw new Error("No accounts returned");
  return accounts[0];
}
