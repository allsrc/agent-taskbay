"use client";

import type { ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import type { ProposedAction } from "@/shared/decision-types";

/**
 * One renderer per typed action kind. A new kind adds an entry here (view and editor) and a server variant;
 * the review page itself never inspects action content.
 */
interface ActionRenderer<K extends ProposedAction["kind"] = ProposedAction["kind"]> {
  label: string;
  view(action: Extract<ProposedAction, { kind: K }>): ReactNode;
  /** Editor for an edit-before-approve; returns the replacement action. */
  editor(props: { action: Extract<ProposedAction, { kind: K }>; onChange: (action: Extract<ProposedAction, { kind: K }>) => void; disabled?: boolean; id: string }): ReactNode;
  isValid(action: Extract<ProposedAction, { kind: K }>): boolean;
}

const sendMessage: ActionRenderer<"send_message"> = {
  label: "Reply sent to the agent",
  view: (action) => (
    <>
      <p className="whitespace-pre-wrap break-words text-[14px]" data-testid="proposed-text">{action.text}</p>
      {action.data && Object.keys(action.data).length > 0 && (
        <pre className="bg-secondary mt-2 max-h-48 overflow-auto rounded-md p-2 font-mono text-[11px]">{JSON.stringify(action.data, null, 2)}</pre>
      )}
    </>
  ),
  editor: ({ action, onChange, disabled, id }) => (
    <Textarea id={id} aria-label="Edited reply" value={action.text} disabled={disabled} rows={5}
      onChange={(event) => onChange({ ...action, text: event.target.value })} />
  ),
  isValid: (action) => action.text.trim().length > 0 && action.text.length <= 20_000,
};
const RENDERERS: { [K in ProposedAction["kind"]]: ActionRenderer<K> } = { send_message: sendMessage };

// The registry is indexed by a discriminant, so TypeScript cannot correlate the entry with the action; one cast contains that.
const rendererFor = (action: ProposedAction) => RENDERERS[action.kind] as ActionRenderer;

export const actionLabel = (action: ProposedAction) => rendererFor(action).label;
export const isActionValid = (action: ProposedAction) => rendererFor(action).isValid(action);
export function ProposedActionView({ action }: { action: ProposedAction }) { return <>{rendererFor(action).view(action)}</>; }
export function ProposedActionEditor(props: { action: ProposedAction; onChange: (action: ProposedAction) => void; disabled?: boolean; id: string }) {
  return <>{rendererFor(props.action).editor(props)}</>;
}
