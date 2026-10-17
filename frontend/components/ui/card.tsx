import { cn } from "./utils";
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-2xl border border-white/15 bg-black/45 backdrop-blur-md p-5 shadow-[0_8px_30px_rgba(0,0,0,0.45)]", className)}>{children}</div>;
}
export function Badge({ tone = "slate", children }: { tone?: "green" | "red" | "yellow" | "slate" | "cyan"; children: React.ReactNode }) {
  const map: Record<string, string> = {
    green: "bg-emerald-400/15 text-emerald-300 border-emerald-300/30",
    red: "bg-red-400/15 text-red-300 border-red-300/30",
    yellow: "bg-yellow-400/15 text-yellow-300 border-yellow-300/30",
    cyan: "bg-cyan-400/15 text-cyan-300 border-cyan-300/30",
    slate: "bg-white/10 text-white/80 border-white/20",
  };
  return <span className={`inline-flex px-3 py-1 rounded-full text-xs border ${map[tone]}`}>{children}</span>;
}
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-cyan-300/50 ${props.className ?? ""}`} />;
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`w-full px-4 py-3 rounded-xl bg-white/10 border border-white/15 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-cyan-300/50 ${props.className ?? ""}`} />;
}
