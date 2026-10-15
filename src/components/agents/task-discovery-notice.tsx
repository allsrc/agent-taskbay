import { Callout } from "@/components/patterns/data-display";

/** Said before an agent is connected: connecting lets Taskbay list the agent's tasks with the agent's credentials, unless the deployment forbids it. */
export function TaskDiscoveryNotice({ cap }: { cap?: string }) {
  if (cap === "off") return <Callout tone="info">Task discovery is turned off for this deployment.</Callout>;
  return (
    <Callout tone="info" title="Tasks started elsewhere">
      Taskbay will be able to list the tasks on this agent using this agent&apos;s credentials. People with access to the whole agent can look at them and choose to track them.
      Nothing is stored until a task is tracked. You can change this on the agent page.
    </Callout>
  );
}
