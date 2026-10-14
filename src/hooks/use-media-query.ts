"use client"

import * as React from "react"

/**
 * Subscribes to a media query. Returns `fallback` during SSR and hydration,
 * then the live value — so layouts never mismatch on hydrate.
 */
export function useMediaQuery(query: string, fallback = false) {
  const subscribe = React.useCallback(
    (callback: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener("change", callback)
      return () => media.removeEventListener("change", callback)
    },
    [query]
  )
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => fallback
  )
}

/** Tailwind `md` breakpoint and up. */
export function useIsDesktop() {
  return useMediaQuery("(min-width: 768px)", true)
}
