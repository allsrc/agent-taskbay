import { cn } from "@/lib/utils";

/** The allsrc.dev mark: a periwinkle prompt chevron and a coral cursor. */
export function LogoMark({ className, size = 30 }: { className?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 240 240" className={className} aria-hidden>
      <rect width="240" height="240" rx="52" fill="#1e1e20" stroke="#2e2e33" strokeWidth="6" />
      <path d="M62 68L120 120L62 172" stroke="#8C8FFF" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="146" y="66" width="34" height="108" rx="7" fill="#FF6B4A" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("font-mono font-bold tracking-tight", className)}>
      <span className="text-primary">a2a</span>
      <span className="text-brand">.client</span>
    </span>
  );
}
