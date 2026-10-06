"use client";

import { useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  A2UI_LIMITS, asText, buildActionMessage, effectiveModel, isBinding, readEvent, resolveValue,
  type A2uiState, type A2uiSurface, type Edits,
} from "@/lib/a2ui";

const JUSTIFY: Record<string, string> = { start: "justify-start", center: "justify-center", end: "justify-end", spaceBetween: "justify-between", spaceAround: "justify-around", spaceEvenly: "justify-evenly", stretch: "justify-stretch" };
const ALIGN: Record<string, string> = { start: "items-start", center: "items-center", end: "items-end", stretch: "items-stretch" };
const TEXT: Record<string, string> = { h1: "text-xl font-bold", h2: "text-lg font-bold", h3: "text-base font-semibold", h4: "text-[15px] font-semibold", h5: "text-sm font-semibold", caption: "text-muted-foreground text-xs", body: "text-sm" };
const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.length <= A2UI_LIMITS.components && value.every((item) => typeof item === "string");
const pick = (map: Record<string, string>, key: unknown, fallback: string) => (typeof key === "string" && Object.hasOwn(map, key) ? map[key] : map[fallback]);

interface Ctx {
  surface: A2uiSurface;
  model: Record<string, unknown>;
  interactive: boolean;
  setValue: (pointer: string, value: unknown) => void;
  fire: (message: unknown) => void;
}

const Placeholder = ({ children }: { children: ReactNode }) => (
  <span className="text-muted-foreground border-border inline-block rounded border border-dashed px-1.5 py-0.5 text-[11px]" data-testid="a2ui-placeholder">{children}</span>
);

/**
 * Renders agent-described UI from an allowlist of Basic Catalog components (ADR 0022). Every string is text, nothing is
 * evaluated, no URL is loaded or opened, and an unsupported component becomes an inert placeholder.
 */
function Node({ ctx, id, depth, trail }: { ctx: Ctx; id: string; depth: number; trail: string[] }) {
  const base = useId();
  const component = ctx.surface.components.get(id);
  if (!component) return <Placeholder>Missing component</Placeholder>;
  if (depth > A2UI_LIMITS.depth || trail.includes(id)) return <Placeholder>Component skipped (nesting)</Placeholder>;
  const next = [...trail, id];
  const child = (childId: unknown) => (typeof childId === "string" ? <Node ctx={ctx} id={childId} depth={depth + 1} trail={next} /> : <Placeholder>Missing child</Placeholder>);
  const text = (value: unknown) => asText(resolveValue(value, ctx.model));
  const kind = String(component.component);

  switch (kind) {
    case "Text":
      return <p className={cn("break-words whitespace-pre-wrap", pick(TEXT, component.variant, "body"))}>{text(component.text)}</p>;
    case "Row":
    case "Column": {
      if (!isIdList(component.children)) return <Placeholder>Unsupported children</Placeholder>;
      return (
        <div className={cn("flex min-w-0 gap-2", kind === "Row" ? "flex-row flex-wrap" : "flex-col", pick(JUSTIFY, component.justify, "start"), pick(ALIGN, component.align, "stretch"))}>
          {component.children.map((childId) => <Node key={childId} ctx={ctx} id={childId} depth={depth + 1} trail={next} />)}
        </div>
      );
    }
    case "Card":
      return <div className="border-border bg-card rounded-xl border p-3">{child(component.child)}</div>;
    case "Divider":
      return component.axis === "vertical" ? <div role="separator" aria-orientation="vertical" className="bg-border w-px self-stretch" /> : <hr className="border-border" />;
    case "Button": {
      const event = readEvent(component.action, ctx.model);
      return (
        <Button type="button" size="sm" variant={component.variant === "primary" ? "brand" : component.variant === "borderless" ? "ghost" : "outline"}
          disabled={!ctx.interactive || !event} title={event ? undefined : "This action is not supported"}
          onClick={() => event && ctx.fire(buildActionMessage(ctx.surface.id, id, event))}>
          {child(component.child)}
        </Button>
      );
    }
    case "TextField": {
      const field = `${base}-f`;
      const binding = isBinding(component.value) ? component.value.path : undefined;
      const value = text(component.value);
      const variant = component.variant;
      const common = { id: field, value, disabled: !ctx.interactive || !binding, onChange: (event: { target: { value: string } }) => binding && ctx.setValue(binding, event.target.value) };
      return (
        <div className="flex flex-col gap-1">
          <label htmlFor={field} className="text-sm font-medium">{text(component.label)}</label>
          {variant === "longText" ? <Textarea rows={4} maxLength={A2UI_LIMITS.text} {...common} />
            : <Input type={variant === "obscured" ? "password" : variant === "number" ? "number" : "text"} maxLength={A2UI_LIMITS.text} autoComplete="off" {...common} />}
        </div>
      );
    }
    case "CheckBox": {
      const field = `${base}-c`;
      const binding = isBinding(component.value) ? component.value.path : undefined;
      return (
        <label htmlFor={field} className="flex items-center gap-2 text-sm">
          <input id={field} type="checkbox" checked={resolveValue(component.value, ctx.model) === true} disabled={!ctx.interactive || !binding}
            onChange={(event) => binding && ctx.setValue(binding, event.target.checked)} />
          {text(component.label)}
        </label>
      );
    }
    case "ChoicePicker": {
      const binding = isBinding(component.value) ? component.value.path : undefined;
      const options = (Array.isArray(component.options) ? component.options : []).slice(0, A2UI_LIMITS.options)
        .flatMap((option) => (option && typeof option === "object" && typeof (option as { value?: unknown }).value === "string"
          ? [{ value: (option as { value: string }).value, label: text((option as { label?: unknown }).label) || (option as { value: string }).value }] : []));
      const current = resolveValue(component.value, ctx.model);
      const selected = Array.isArray(current) ? current.filter((item): item is string => typeof item === "string") : typeof current === "string" ? [current] : [];
      const multiple = component.variant === "multipleSelection";
      const toggle = (value: string, on: boolean) => binding && ctx.setValue(binding, multiple ? (on ? [...selected, value] : selected.filter((item) => item !== value)) : [value]);
      return (
        <fieldset className="flex flex-col gap-1" disabled={!ctx.interactive || !binding}>
          {component.label !== undefined && <legend className="mb-1 text-sm font-medium">{text(component.label)}</legend>}
          {options.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input type={multiple ? "checkbox" : "radio"} name={`${base}-p`} checked={selected.includes(option.value)} onChange={(event) => toggle(option.value, event.target.checked)} />
              {option.label}
            </label>
          ))}
        </fieldset>
      );
    }
    default:
      return <Placeholder>Unsupported component “{kind.slice(0, 40)}”</Placeholder>;
  }
}

/**
 * The task's A2UI surfaces. `interactive` is false once the task is finished, and the viewer's own input is kept
 * separately from the agent's data model so an agent update never loses what was typed.
 */
export function A2uiSurfaces({ state, interactive, onAction }: { state: A2uiState; interactive: boolean; onAction: (message: unknown) => void }) {
  const [edits, setEdits] = useState<Record<string, Edits>>({});
  const surfaces = [...state.surfaces.values()];
  if (surfaces.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="a2ui-surfaces">
      {surfaces.map((surface) => {
        const mine = edits[surface.id] ?? [];
        const ctx: Ctx = {
          surface, interactive, model: effectiveModel(surface, mine), fire: onAction,
          setValue: (pointer, value) => setEdits((current) => ({ ...current, [surface.id]: [...(current[surface.id] ?? []).filter(([existing]) => existing !== pointer), [pointer, value]] })),
        };
        return (
          <section key={surface.id} aria-label={`Agent interface ${surface.id}`} data-testid="a2ui-surface" className="border-border bg-popover max-w-[560px] rounded-[14px] border p-3">
            {!surface.supported ? <Placeholder>This agent chose a catalog this console does not render.</Placeholder>
              : surface.components.has("root") ? <Node ctx={ctx} id="root" depth={0} trail={[]} /> : <Placeholder>Waiting for the agent…</Placeholder>}
            <p className="text-muted-foreground mt-2 font-mono text-[10px]">Interface described by the agent · rendered by the console</p>
          </section>
        );
      })}
      {state.rejected > 0 && <p className="text-muted-foreground font-mono text-[11px]">{state.rejected} invalid interface update{state.rejected === 1 ? "" : "s"} ignored.</p>}
    </div>
  );
}
