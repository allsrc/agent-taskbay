import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shows that the Tasks list is narrowed to one context, and clears it. The id renders as text, shortened to 8 characters. */
export function ContextFilterChip({ contextId, onClear }: { contextId: string; onClear: () => void }) {
  return (
    <Button variant="outline" size="xs" onClick={onClear} aria-label={`Remove context filter ${contextId.slice(0, 8)}`} className="font-mono">
      Context: {contextId.slice(0, 8)} <X />
    </Button>
  );
}
