import { ViewTransition } from "react"

/**
 * Wraps route content so navigations animate like an app.
 * - default: short fade + lift
 * - `nav-forward` / `nav-back` transition types (set on <Link transitionTypes>):
 *   directional slide, like pushing / popping a screen.
 * Used from `template.tsx`, which remounts on every navigation.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const motion = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "page" }
  return (
    <ViewTransition enter={motion} exit={motion} default="none">
      {children}
    </ViewTransition>
  )
}
