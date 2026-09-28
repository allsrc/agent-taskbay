"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

const emptySubscribe = () => () => {};

/** True only once mounted on the client, without setState-in-effect (avoids a hydration mismatch on resolvedTheme). */
function useIsClient() {
  return React.useSyncExternalStore(emptySubscribe, () => true, () => false);
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const isClient = useIsClient();

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {isClient && resolvedTheme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
