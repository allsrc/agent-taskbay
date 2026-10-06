import type { NormalizedPart } from "@/lib/types";

/** Extension an agent advertises to opt in to console-rendered input forms. Negotiation stays URI-based and opt-in. */
export const STRUCTURED_FORM_EXTENSION_URI = "https://a2a-ops.dev/extensions/structured-form/v1";
export const STRUCTURED_FORM_MEDIA_TYPE = "application/vnd.a2a-ops.form+json";

export const FORM_LIMITS = { fields: 30, options: 50, label: 120, text: 2_000, stringMax: 10_000 } as const;

interface FieldBase { key: string; label: string; description?: string; required: boolean }
export type FormField =
  | (FieldBase & { type: "string"; minLength?: number; maxLength?: number; multiline: boolean; default?: string })
  | (FieldBase & { type: "number" | "integer"; minimum?: number; maximum?: number; default?: number })
  | (FieldBase & { type: "boolean"; default?: boolean })
  | (FieldBase & { type: "enum"; options: Array<{ value: string; label: string }>; default?: string });

export interface FormDefinition { title: string; description?: string; submitLabel: string; fields: FormField[] }
export type FormValues = Record<string, string | number | boolean | undefined>;
export type FormSubmission = Record<string, string | number | boolean>;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const text = (value: unknown, max: number): string | undefined => (typeof value === "string" && value.length > 0 ? value.slice(0, max) : undefined);

/** Names that collide with Object.prototype members would read inherited values (`toString`) or reach the prototype (`__proto__`). */
const RESERVED = new Set(["__proto__", "constructor", "prototype", "toString", "valueOf", "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString", "__defineGetter__", "__defineSetter__", "__lookupGetter__", "__lookupSetter__"]);

function parseField(key: string, raw: unknown, required: boolean): FormField | undefined {
  if (!KEY.test(key) || RESERVED.has(key) || !isObject(raw)) return undefined;
  const base = { key, label: text(raw.title, FORM_LIMITS.label) ?? key, description: text(raw.description, FORM_LIMITS.text), required };
  if (Array.isArray(raw.enum)) {
    if (raw.enum.length === 0 || raw.enum.length > FORM_LIMITS.options || !raw.enum.every((item) => typeof item === "string")) return undefined;
    const names = Array.isArray(raw.enumNames) && raw.enumNames.length === raw.enum.length ? raw.enumNames : raw.enum;
    const options = (raw.enum as string[]).map((value, index) => ({ value, label: text(names[index], FORM_LIMITS.label) ?? value }));
    const fallback = typeof raw.default === "string" && raw.enum.includes(raw.default) ? raw.default : undefined;
    return { ...base, type: "enum", options, default: fallback };
  }
  switch (raw.type) {
    case "string": {
      const minLength = finite(raw.minLength) && raw.minLength >= 0 ? Math.floor(raw.minLength) : undefined;
      const maxLength = finite(raw.maxLength) && raw.maxLength >= 0 ? Math.min(Math.floor(raw.maxLength), FORM_LIMITS.stringMax) : undefined;
      return { ...base, type: "string", minLength, maxLength, multiline: raw.format === "multiline" || (maxLength ?? 0) > 200,
        default: typeof raw.default === "string" ? raw.default.slice(0, FORM_LIMITS.stringMax) : undefined };
    }
    case "number":
    case "integer":
      return { ...base, type: raw.type, minimum: finite(raw.minimum) ? raw.minimum : undefined, maximum: finite(raw.maximum) ? raw.maximum : undefined,
        default: finite(raw.default) ? raw.default : undefined };
    case "boolean":
      return { ...base, type: "boolean", default: typeof raw.default === "boolean" ? raw.default : undefined };
    default:
      return undefined;
  }
}

/**
 * Parses an agent-supplied form into the supported, flat JSON-Schema subset. Any construct outside that
 * subset (nesting, `$ref`, `pattern`, unknown types, too many fields) rejects the whole form so the caller
 * falls back to the generic composer. Nothing in the definition is ever evaluated or rendered as markup.
 */
export function parseFormDefinition(value: unknown): FormDefinition | undefined {
  if (!isObject(value) || !isObject(value.schema)) return undefined;
  const schema = value.schema;
  if (schema.type !== "object" || !isObject(schema.properties)) return undefined;
  const entries = Object.entries(schema.properties);
  if (entries.length === 0 || entries.length > FORM_LIMITS.fields) return undefined;
  const required = new Set(Array.isArray(schema.required) ? schema.required.filter((item): item is string => typeof item === "string") : []);
  // Message parts are stored as JSONB, which does not preserve object key order, so display order is explicit.
  const order = Array.isArray(value.order) ? value.order.filter((item): item is string => typeof item === "string") : [];
  const rank = (key: string) => { const index = order.indexOf(key); return index === -1 ? order.length : index; };
  entries.sort(([a], [b]) => rank(a) - rank(b));
  const fields: FormField[] = [];
  for (const [key, raw] of entries) {
    const field = parseField(key, raw, required.has(key));
    if (!field) return undefined;
    fields.push(field);
  }
  return {
    title: text(value.title, FORM_LIMITS.label) ?? "Agent request",
    description: text(value.description, FORM_LIMITS.text),
    submitLabel: text(value.submitLabel, 40) ?? "Submit",
    fields,
  };
}

/** True only when the agent advertised the extension and the part is a well-formed form definition. */
export function formFromPart(part: NormalizedPart, advertisedExtensions: readonly string[]): FormDefinition | undefined {
  if (part.kind !== "data" || part.mediaType !== STRUCTURED_FORM_MEDIA_TYPE) return undefined;
  if (!advertisedExtensions.includes(STRUCTURED_FORM_EXTENSION_URI)) return undefined;
  return parseFormDefinition(part.value);
}

/**
 * The agent's start-of-task form: the `startForm` entry of the structured-form extension's card params, honoured only when
 * the agent advertises the extension and the definition validates.
 */
export function startFormFromCard(extensions: readonly string[], extensionParams: Record<string, Record<string, unknown>> | undefined): FormDefinition | undefined {
  if (!extensions.includes(STRUCTURED_FORM_EXTENSION_URI)) return undefined;
  return parseFormDefinition(extensionParams?.[STRUCTURED_FORM_EXTENSION_URI]?.startForm);
}

export function initialValues(form: FormDefinition): FormValues {
  const values: FormValues = {};
  for (const field of form.fields) {
    if (field.default !== undefined) values[field.key] = field.default;
    else if (field.type === "boolean") values[field.key] = false;
  }
  return values;
}

export type FormErrors = Record<string, string>;

/** Validates raw input; the submission contains exactly the declared keys, coerced to their declared types. */
export function validateForm(form: FormDefinition, values: FormValues): { submission: FormSubmission; errors: FormErrors } {
  const submission: FormSubmission = {};
  const errors: FormErrors = {};
  for (const field of form.fields) {
    const raw = Object.prototype.hasOwnProperty.call(values, field.key) ? values[field.key] : undefined;
    const empty = raw === undefined || raw === "" || (field.type === "number" || field.type === "integer" ? Number.isNaN(raw) : false);
    if (field.type === "boolean") { submission[field.key] = raw === true; continue; }
    if (empty) { if (field.required) errors[field.key] = "Required"; continue; }
    switch (field.type) {
      case "string": {
        const value = String(raw);
        if (field.minLength !== undefined && value.length < field.minLength) errors[field.key] = `At least ${field.minLength} characters`;
        else if (value.length > (field.maxLength ?? FORM_LIMITS.stringMax)) errors[field.key] = `At most ${field.maxLength ?? FORM_LIMITS.stringMax} characters`;
        else submission[field.key] = value;
        break;
      }
      case "number":
      case "integer": {
        const value = typeof raw === "number" ? raw : Number(raw);
        if (!Number.isFinite(value)) errors[field.key] = "Enter a number";
        else if (field.type === "integer" && !Number.isInteger(value)) errors[field.key] = "Enter a whole number";
        else if (field.minimum !== undefined && value < field.minimum) errors[field.key] = `At least ${field.minimum}`;
        else if (field.maximum !== undefined && value > field.maximum) errors[field.key] = `At most ${field.maximum}`;
        else submission[field.key] = value;
        break;
      }
      case "enum":
        if (field.options.some((option) => option.value === raw)) submission[field.key] = String(raw);
        else errors[field.key] = "Choose one of the options";
        break;
    }
  }
  return { submission, errors };
}
