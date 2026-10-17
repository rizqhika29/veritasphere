import * as React from "react";
import { cn } from "./utils";
export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("px-5 py-2.5 rounded-full bg-white text-slate-900 font-medium hover:scale-105 transition disabled:opacity-50", className)} {...props} />;
}
export function GhostButton({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("px-5 py-2.5 rounded-full border border-white/20 text-white/90 hover:border-white/50 transition disabled:opacity-50", className)} {...props} />;
}
