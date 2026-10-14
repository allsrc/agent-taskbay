import type { Route } from "next"
import type { LucideIcon } from "lucide-react"

export type NavItem = {
  title: string
  href: Route
  icon: LucideIcon
  /** Match prefix for the active state when it differs from `href`. */
  match?: string
  description?: string
  /**
   * Active only on an exact pathname. Set this on a root tab such as Home
   * so `/` or `/app` does not stay selected on child screens.
   */
  exact?: boolean
}

export function isActive(pathname: string, item: NavItem) {
  const target = item.match ?? item.href.split("?")[0]
  if (item.exact || target === "/") return pathname === target
  return pathname === target || pathname.startsWith(`${target}/`)
}
