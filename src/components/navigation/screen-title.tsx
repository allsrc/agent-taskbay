"use client"

import * as React from "react"

/**
 * Tiny external store holding the current screen's title, so the persistent
 * mobile top bar can show it (native "collapsing large title" behaviour)
 * without every page re-rendering the shell.
 */
let current: string | null = null
const listeners = new Set<() => void>()

function set(title: string | null) {
  if (current === title) return
  current = title
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useScreenTitle() {
  return React.useSyncExternalStore(subscribe, () => current, () => null)
}

/** Render once per screen (PageHeader does this for you). */
export function ScreenTitle({ title }: { title: string }) {
  React.useEffect(() => {
    set(title)
    return () => set(null)
  }, [title])
  return null
}

/** True once the page has scrolled past the large title. */
export function useScrolledPast(offset = 56) {
  const subscribeScroll = React.useCallback((callback: () => void) => {
    window.addEventListener("scroll", callback, { passive: true })
    return () => window.removeEventListener("scroll", callback)
  }, [])
  return React.useSyncExternalStore(
    subscribeScroll,
    () => window.scrollY > offset,
    () => false
  )
}
