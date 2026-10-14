"use client"

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { cn } from "@/lib/utils"

import { SegmentedControl } from "@/components/patterns/segmented-control"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { useTheme, type ThemePreference } from "./theme-provider"

export const themeOptions: {
  value: ThemePreference
  label: string
  icon: typeof SunIcon
}[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
]

/** Three-way segmented control. Used in footers, settings and menus. */
export function ThemeSegmented({
  className,
  size = "sm",
}: {
  className?: string
  size?: "sm" | "md"
}) {
  const { preference, setPreference } = useTheme()
  return (
    <SegmentedControl
      label="Theme"
      value={preference}
      onValueChange={setPreference}
      size={size}
      className={className}
      options={themeOptions.map((o) => ({ ...o, iconOnly: size === "sm" }))}
    />
  )
}

/** Compact icon button with a dropdown — for headers and toolbars. */
export function ThemeMenu({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn("text-muted-foreground", className)}
            aria-label="Change theme"
          />
        }
      >
        <SunIcon className="dark:hidden" />
        <MoonIcon className="hidden dark:block" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={preference}
            onValueChange={(value) => setPreference(value as ThemePreference)}
          >
            {themeOptions.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
