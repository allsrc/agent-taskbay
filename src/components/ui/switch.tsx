"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "data-[state=checked]:bg-primary data-[state=unchecked]:bg-border focus-visible:ring-ring/50 inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="bg-foreground pointer-events-none block size-[18px] rounded-full transition-transform data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[2px]" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
