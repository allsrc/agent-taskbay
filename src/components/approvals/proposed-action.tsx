"use client";

import type { ReactNode } from "react";
import { Textarea } from "@/components/ui/textarea";
import { FormFields } from "@/components/chat/structured-form";
import { parseFormDefinition, validateForm, type FormValues } from "@/lib/structured-form";
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
const shown = (value: string | number | boolean | undefined) => (value === undefined || value === "" ? "—" : typeof value === "boolean" ? (value ? "Yes" : "No") : String(value));

/** Structured reply (ADR 0015 addendum): the pinned form gives each value its label; only the values are editable. */
const sendData: ActionRenderer<"send_data"> = {
  label: "Form data sent to the agent",
  view: (action) => {
    const form = parseFormDefinition(action.form);
    return (
      <div data-testid="proposed-data">
        {form && <p className="mb-1.5 text-[13px] font-medium">{form.title}</p>}
        <dl className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
          {(form?.fields ?? Object.keys(action.values).map((key) => ({ key, label: key }))).map((field) => (
            <div key={field.key} className="contents"><dt className="text-muted-foreground">{field.label}</dt><dd className="break-words">{shown(action.values[field.key])}</dd></div>
          ))}
        </dl>
        <p className="text-muted-foreground mt-2 font-mono text-[11px]">Sent as one JSON data part.</p>
      </div>
    );
  },
  editor: ({ action, onChange, disabled, id }) => {
    const form = parseFormDefinition(action.form);
    if (!form) return <p role="alert" className="text-destructive text-sm">This form cannot be edited.</p>;
    const values: FormValues = action.values;
    const errors = validateForm(form, values).errors;
    return (
      <div id={id} role="group" aria-label="Edited values" className="flex flex-col gap-3">
        <FormFields form={form} values={values} errors={errors} disabled={disabled}
          onChange={(key, value) => { const next = { ...action.values } as Record<string, string | number | boolean>; if (value === undefined || value === "") delete next[key]; else next[key] = value; onChange({ ...action, values: next }); }} />
      </div>
    );
  },
  isValid: (action) => { const form = parseFormDefinition(action.form); return !!form && Object.keys(validateForm(form, action.values).errors).length === 0; },
};
const RENDERERS: { [K in ProposedAction["kind"]]: ActionRenderer<K> } = { send_message: sendMessage, send_data: sendData };

// The registry is indexed by a discriminant, so TypeScript cannot correlate the entry with the action; one cast contains that.
const rendererFor = (action: ProposedAction) => RENDERERS[action.kind] as ActionRenderer;

export const actionLabel = (action: ProposedAction) => rendererFor(action).label;
export const isActionValid = (action: ProposedAction) => rendererFor(action).isValid(action);
export function ProposedActionView({ action }: { action: ProposedAction }) { return <>{rendererFor(action).view(action)}</>; }
export function ProposedActionEditor(props: { action: ProposedAction; onChange: (action: ProposedAction) => void; disabled?: boolean; id: string }) {
  return <>{rendererFor(props.action).editor(props)}</>;
}
