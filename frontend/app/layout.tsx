import "./globals.css";
import dynamic from "next/dynamic";
import { Navbar, Footer } from "@/components/Navbar";

// Warp pakai WebGL — tidak bisa SSR/prerender. Load client-only.
const SphereBackground = dynamic(() => import("@/components/SphereBackground"), {
  ssr: false,
  loading: () => <div aria-hidden className="fixed inset-0 bg-sphere-950" />,
});

export const metadata = {
  title: "Veritasphere — Sphere of Verified Truth",
  description: "Crowd-sourced knowledge, AI-validated on GenLayer.",
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-sphere-950 min-h-screen text-white antialiased">
        <SphereBackground />
        <div className="relative z-10">
          <Navbar />
          <main className="[&_h1]:drop-shadow-[0_2px_16px_rgba(0,0,0,0.8)] [&_p]:drop-shadow-[0_1px_10px_rgba(0,0,0,0.7)]">
            {children}
          </main>
          <Footer />
        </div>
      </body>
    </html>
  );
}
