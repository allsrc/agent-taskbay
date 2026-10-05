import { describe, expect, it } from "vitest";
import type { NormalizedPart } from "@/lib/types";
import { STRUCTURED_FORM_EXTENSION_URI, STRUCTURED_FORM_MEDIA_TYPE, formFromPart, initialValues, parseFormDefinition, startFormFromCard, validateForm } from "./structured-form";

const definition = {
  title: "Deploy", submitLabel: "Send",
  schema: { type: "object", required: ["env", "replicas"], properties: {
    env: { type: "string", title: "Environment", enum: ["staging", "prod"], enumNames: ["Staging", "Production"] },
    replicas: { type: "integer", minimum: 1, maximum: 10, default: 2 },
    note: { type: "string", maxLength: 20 },
    dryRun: { type: "boolean" },
  } },
};
const part = (value: unknown, mediaType = STRUCTURED_FORM_MEDIA_TYPE): NormalizedPart => ({ id: "p", kind: "data", value, mediaType });

describe("structured form definitions", () => {
  it("parses the supported schema subset", () => {
    const form = parseFormDefinition(definition)!;
    expect(form.title).toBe("Deploy");
    expect(form.fields.map((field) => [field.key, field.type, field.required])).toEqual([
      ["env", "enum", true], ["replicas", "integer", true], ["note", "string", false], ["dryRun", "boolean", false]]);
    expect(form.fields[0]).toMatchObject({ options: [{ value: "staging", label: "Staging" }, { value: "prod", label: "Production" }] });
  });
  it("displays fields in the declared order, since stored JSON loses key order", () => {
    const scrambled = { ...definition, order: ["env", "replicas", "note", "dryRun"], schema: { ...definition.schema, properties: {
      dryRun: definition.schema.properties.dryRun, note: definition.schema.properties.note, replicas: definition.schema.properties.replicas, env: definition.schema.properties.env } } };
    expect(parseFormDefinition(scrambled)!.fields.map((field) => field.key)).toEqual(["env", "replicas", "note", "dryRun"]);
    expect(parseFormDefinition({ ...scrambled, order: ["note"] })!.fields.map((field) => field.key)).toEqual(["note", "dryRun", "replicas", "env"]);
  });
  it("rejects anything outside the subset so the caller falls back to the composer", () => {
    const withProperty = (property: unknown) => ({ schema: { type: "object", properties: { a: property } } });
    for (const bad of [null, [], { schema: {} }, { schema: { type: "array" } }, { schema: { type: "object", properties: {} } },
      withProperty({ type: "object" }), withProperty({ $ref: "#/x" }), withProperty({ type: "string", enum: [] }),
      withProperty({ type: "string", enum: [1, 2] }), withProperty("string"),
      { schema: { type: "object", properties: { "bad key": { type: "string" } } } },
      { schema: { type: "object", properties: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`f${i}`, { type: "string" }])) } }]) {
      expect(parseFormDefinition(bad)).toBeUndefined();
    }
  });
  it("does not treat markup or script in labels as anything but text", () => {
    const form = parseFormDefinition({ title: "<img src=x onerror=alert(1)>", schema: { type: "object", properties: { a: { type: "string", title: "<script>1</script>" } } } })!;
    expect(form.title).toBe("<img src=x onerror=alert(1)>");
    expect(form.fields[0].label).toBe("<script>1</script>");
  });
  it("renders only when the extension is advertised and the media type matches", () => {
    expect(formFromPart(part(definition), [STRUCTURED_FORM_EXTENSION_URI])).toBeDefined();
    expect(formFromPart(part(definition), [])).toBeUndefined();
    expect(formFromPart(part(definition), ["https://example.com/other"])).toBeUndefined();
    expect(formFromPart(part(definition, "application/json"), [STRUCTURED_FORM_EXTENSION_URI])).toBeUndefined();
    expect(formFromPart({ ...part(definition), kind: "text" }, [STRUCTURED_FORM_EXTENSION_URI])).toBeUndefined();
  });
});

describe("start-of-task form", () => {
  const params = { [STRUCTURED_FORM_EXTENSION_URI]: { startForm: definition } };
  it("is offered only when the extension is advertised and the definition validates", () => {
    expect(startFormFromCard([STRUCTURED_FORM_EXTENSION_URI], params)?.title).toBe("Deploy");
    expect(startFormFromCard([], params)).toBeUndefined();
    expect(startFormFromCard(["https://example.com/other"], params)).toBeUndefined();
    expect(startFormFromCard([STRUCTURED_FORM_EXTENSION_URI], undefined)).toBeUndefined();
    expect(startFormFromCard([STRUCTURED_FORM_EXTENSION_URI], { [STRUCTURED_FORM_EXTENSION_URI]: {} })).toBeUndefined();
    expect(startFormFromCard([STRUCTURED_FORM_EXTENSION_URI], { [STRUCTURED_FORM_EXTENSION_URI]: { startForm: { schema: { type: "object", properties: { n: { type: "object" } } } } } })).toBeUndefined();
  });
});

describe("structured form validation", () => {
  const form = parseFormDefinition(definition)!;
  it("seeds defaults and coerces to the declared types", () => {
    expect(initialValues(form)).toEqual({ replicas: 2, dryRun: false });
    const { submission, errors } = validateForm(form, { env: "prod", replicas: "3" as never, dryRun: true, note: "hi" });
    expect(errors).toEqual({});
    expect(submission).toEqual({ env: "prod", replicas: 3, dryRun: true, note: "hi" });
  });
  it("reports required, range, type and option errors without submitting unknown keys", () => {
    const { submission, errors } = validateForm(form, { replicas: 11, env: "dev", note: "x".repeat(21), extra: "nope" } as never);
    expect(errors).toEqual({ env: "Choose one of the options", replicas: "At most 10", note: "At most 20 characters" });
    expect(Object.keys(submission)).toEqual(["dryRun"]);
    expect(validateForm(form, {}).errors).toEqual({ env: "Required", replicas: "Required" });
    expect(validateForm(form, { env: "prod", replicas: 1.5 }).errors).toEqual({ replicas: "Enter a whole number" });
  });
});
