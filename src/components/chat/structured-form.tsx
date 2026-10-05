"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { initialValues, validateForm, type FormDefinition, type FormErrors, type FormField, type FormSubmission, type FormValues } from "@/lib/structured-form";

/**
 * Renders an agent-supplied form from the allowlisted field kinds only. Every string is rendered as text; the
 * submission is the validated values object, sent back as an ordinary application/json data part.
 */
export function StructuredForm({ form, disabled, onSubmit }: { form: FormDefinition; disabled?: boolean; onSubmit: (submission: FormSubmission) => void | Promise<void> }) {
  const [values, setValues] = useState<FormValues>(() => initialValues(form));
  const [errors, setErrors] = useState<FormErrors>({});

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const result = validateForm(form, values);
    setErrors(result.errors);
    if (Object.keys(result.errors).length === 0) void onSubmit(result.submission);
  }

  return (
    <form onSubmit={submit} noValidate aria-label={form.title} className="flex w-full min-w-[260px] flex-col gap-3" data-testid="structured-form">
      <div>
        <p className="text-[14px] font-medium">{form.title}</p>
        {form.description && <p className="text-muted-foreground mt-0.5 text-xs whitespace-pre-wrap">{form.description}</p>}
      </div>
      <FormFields form={form} values={values} errors={errors} disabled={disabled} onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))} />
      <div><Button type="submit" variant="brand" size="sm" disabled={disabled}>{form.submitLabel}</Button></div>
    </form>
  );
}

/** The controlled field list shared by the chat form and the approval editor. Strings render as text only. */
export function FormFields({ form, values, errors, disabled, onChange }: {
  form: FormDefinition; values: FormValues; errors: FormErrors; disabled?: boolean; onChange: (key: string, value: FormValues[string]) => void;
}) {
  const base = useId();
  return (
    <>
      {form.fields.map((field) => {
        const id = `${base}-${field.key}`;
        const error = errors[field.key];
        return (
          <div key={field.key} className="flex flex-col gap-1">
            {field.type === "boolean" ? (
              <label htmlFor={id} className="flex items-center gap-2 text-sm">
                <input id={id} type="checkbox" checked={values[field.key] === true} disabled={disabled}
                  onChange={(event) => onChange(field.key, event.target.checked)} />
                {field.label}
              </label>
            ) : (
              <label htmlFor={id} className="text-sm font-medium">{field.label}{field.required && <span aria-hidden className="text-brand"> *</span>}</label>
            )}
            {field.type !== "boolean" && <FieldInput id={id} field={field} value={values[field.key]} disabled={disabled} invalid={!!error} onChange={(value) => onChange(field.key, value)} />}
            {field.description && <p id={`${id}-hint`} className="text-muted-foreground text-xs">{field.description}</p>}
            {error && <p id={`${id}-error`} role="alert" className="text-brand text-xs">{error}</p>}
          </div>
        );
      })}
    </>
  );
}

function FieldInput({ id, field, value, disabled, invalid, onChange }: {
  id: string; field: Exclude<FormField, { type: "boolean" }>; value: FormValues[string]; disabled?: boolean; invalid: boolean; onChange: (value: FormValues[string]) => void;
}) {
  const aria = { "aria-invalid": invalid || undefined, "aria-describedby": invalid ? `${id}-error` : field.description ? `${id}-hint` : undefined, "aria-required": field.required || undefined };
  switch (field.type) {
    case "string":
      return field.multiline
        ? <Textarea id={id} rows={4} value={String(value ?? "")} disabled={disabled} maxLength={field.maxLength} onChange={(event) => onChange(event.target.value)} {...aria} />
        : <Input id={id} value={String(value ?? "")} disabled={disabled} maxLength={field.maxLength} onChange={(event) => onChange(event.target.value)} {...aria} />;
    case "number":
    case "integer":
      return <Input id={id} type="number" inputMode={field.type === "integer" ? "numeric" : "decimal"} step={field.type === "integer" ? 1 : "any"} min={field.minimum} max={field.maximum}
        value={value === undefined ? "" : String(value)} disabled={disabled} onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))} {...aria} />;
    case "enum":
      return (
        <select id={id} value={String(value ?? "")} disabled={disabled} onChange={(event) => onChange(event.target.value || undefined)}
          className="border-input bg-background h-9 rounded-md border px-2 text-sm" {...aria}>
          <option value="">Select…</option>
          {field.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      );
  }
}
