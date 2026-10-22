/** @type {import('next').NextConfig} */

// NEXT_PUBLIC_* are inlined at build time. Prefer process.env (Vercel dashboard
// or frontend/.env.production loaded by @next/env); fall back to the audited
// deploy values so a missing/empty dashboard var can never ship an unconfigured
// build (steward finding: "CONTRACT NOT CONFIGURED" after deploy).
const FALLBACKS = {
  NEXT_PUBLIC_CONTRACT_ADDRESS: "0x2C15F9E7822Aa78c6940Dd4abC246b86849dEC8A",
  NEXT_PUBLIC_RPC_URL: "https://studio.genlayer.com/api",
  NEXT_PUBLIC_CHAIN: "studionet",
};

const nextConfig = {
  reactStrictMode: true,
  env: Object.fromEntries(
    Object.entries(FALLBACKS).map(([key, fallback]) => [key, process.env[key] || fallback]),
  ),
};

module.exports = nextConfig;
