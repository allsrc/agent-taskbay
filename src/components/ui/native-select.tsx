import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * A native `<select>` styled like `Input`. Use it in plain forms that read values with `FormData`;
 * use `Select` when you need a custom popup.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative w-full min-w-0">
      <select
        data-slot="native-select"
        className={cn(
          "h-8 w-full min-w-0 appearance-none rounded-lg border border-input bg-transparent py-1 pr-8 pl-2.5 text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 [&>option]:bg-popover [&>option]:text-popover-foreground",
          className
        )}
        {...props}
      >
        {children}
      </select>
      {/* A bordered square rather than an icon, so the control never emits <svg> (the form renderer must stay free of media). */}
      <span aria-hidden className="pointer-events-none absolute top-1/2 right-3 size-1.5 -translate-y-[70%] rotate-45 border-r-[1.5px] border-b-[1.5px] border-muted-foreground" />
    </div>
  )
}

export { NativeSelect }
