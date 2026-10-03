import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/a2a/primitives";

export default function TasksIndex() {
  return (
    <EmptyState icon={<ListChecks className="size-7" />} title="Pick a task">
      See its status timeline, history and artifacts, or jump back into the chat it belongs to.
    </EmptyState>
  );
}
