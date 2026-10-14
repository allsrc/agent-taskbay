import { PageTransition } from "@/components/navigation/page-transition"

/** Re-mounts on every navigation so route changes fade and slide. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <PageTransition>
      <div className="flex min-w-0 flex-1 flex-col md:min-h-0">{children}</div>
    </PageTransition>
  )
}
