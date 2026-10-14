"use client"

import * as React from "react"

import { THEME_STORAGE_KEY } from "./theme-script"

export type ThemePreference = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

type ThemeContextValue = {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

const listeners = new Set<() => void>()
const MEDIA = "(prefers-color-scheme: dark)"

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === "light" || stored === "dark" ? stored : "system"
  } catch {
    return "system"
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  const media = window.matchMedia(MEDIA)
  const onStorage = (event: StorageEvent) => {
    if (event.key === THEME_STORAGE_KEY) callback()
  }
  media.addEventListener("change", callback)
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(callback)
    media.removeEventListener("change", callback)
    window.removeEventListener("storage", onStorage)
  }
}

function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference
  return window.matchMedia(MEDIA).matches ? "dark" : "light"
}

function apply(resolved: ResolvedTheme, preference: ThemePreference) {
  const root = document.documentElement
  // Design-system preview frames pin their own theme.
  if (root.dataset.themeLock) return
  // Suppress transitions for one frame so the swap is instant everywhere.
  root.classList.add("theme-switching")
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
  root.dataset.themePreference = preference
  window.requestAnimationFrame(() =>
    window.requestAnimationFrame(() => root.classList.remove("theme-switching"))
  )
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const preference = React.useSyncExternalStore(
    subscribe,
    readPreference,
    () => "system" as ThemePreference
  )
  const resolvedTheme = React.useSyncExternalStore(
    subscribe,
    () => resolve(readPreference()),
    () => "dark" as ResolvedTheme
  )

  React.useEffect(() => {
    apply(resolvedTheme, preference)
  }, [resolvedTheme, preference])

  const setPreference = React.useCallback((next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_STORAGE_KEY)
      else localStorage.setItem(THEME_STORAGE_KEY, next)
    } catch {
      // Storage unavailable: still apply for this page view.
    }
    apply(resolve(next), next)
    listeners.forEach((listener) => listener())
  }, [])

  const value = React.useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference]
  )

  return <ThemeContext value={value}>{children}</ThemeContext>
}

export function useTheme() {
  const context = React.useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used within ThemeProvider")
  return context
}
