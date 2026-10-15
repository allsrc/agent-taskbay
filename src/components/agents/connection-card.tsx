"use client";

import { Chip, InfoCard } from "@/components/a2a/primitives";
import { DefinitionList } from "@/components/patterns/layout";
import { Eyebrow, Pill } from "@/components/patterns/status";
import type { ConnectionView } from "@/lib/connection-interface";

const count = (n: number, word: string) => `${n} ${word}`;

/**
 * What a connection uses: interface, protocol version, tenant and extensions. Every value comes from the agent's card or the saved
 * connection settings and is shown as text, never as a link. The tenant is chosen per conversation in the chat options.
 */
export function ConnectionCard({ connection, bindings }: { connection: ConnectionView; bindings: string[] }) {
  const { negotiated, ignored, unsupportedRequired } = connection;
  const extensionCount = negotiated.length + ignored.length + unsupportedRequired.length;
  const summary = extensionCount === 0 ? "None advertised" : [
    negotiated.length ? `${count(negotiated.length, "negotiated")}` : "",
    ignored.length ? `${count(ignored.length, "ignored")}` : "",
    unsupportedRequired.length ? `${count(unsupportedRequired.length, "required, not supported")}` : "",
  ].filter(Boolean).join(" · ");
  const tenant = connection.tenants.length > 1
    ? `${connection.tenants.length} tenants: ${connection.tenants.join(", ")}`
    : connection.tenant || "(default)";
  return (
    <InfoCard label="Connection">
      <DefinitionList
        items={[
          { label: "Binding", value: connection.binding ?? "—" },
          { label: "Interface", value: <span className="font-mono text-xs" title={connection.interfaceUrl ?? undefined}>{connection.interfaceUrl ?? "—"}</span> },
          { label: "Protocol", value: connection.protocolVersion ?? "—" },
          { label: "Tenant", value: <span className="font-mono text-xs" title={tenant}>{tenant}</span> },
          { label: "Required", value: unsupportedRequired.length ? <Pill tone="danger">{count(unsupportedRequired.length, "not supported")}</Pill>
            : <Pill tone="success">{connection.required.length ? "All supported" : "None"}</Pill> },
        ]}
      />
      {bindings.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <Eyebrow>Advertised bindings</Eyebrow>
          <div className="flex flex-wrap gap-1.5">{bindings.map((binding) => <Chip key={binding}>{binding}</Chip>)}</div>
        </div>
      )}
      {connection.pinned && <p className="mt-3 text-sm text-muted-foreground">Pinned by your connection settings.</p>}
      {connection.tenants.length > 1 && (
        <p className="mt-3 text-sm text-muted-foreground">Choose the tenant for a new conversation in the chat options.</p>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Extensions: {summary}</summary>
        {extensionCount > 0 && (
          <ul className="mt-2 space-y-1.5">
            {unsupportedRequired.map((uri) => <ExtensionRow key={`u-${uri}`} uri={uri} tone="danger" label="required, not supported" />)}
            {negotiated.map((uri) => <ExtensionRow key={`n-${uri}`} uri={uri} tone="success" label="negotiated" />)}
            {ignored.map((uri) => <ExtensionRow key={`i-${uri}`} uri={uri} tone="neutral" label="ignored" />)}
          </ul>
        )}
      </details>
    </InfoCard>
  );
}

function ExtensionRow({ uri, tone, label }: { uri: string; tone: "danger" | "success" | "neutral"; label: string }) {
  return (
    <li className="flex flex-wrap items-start gap-2">
      <Pill tone={tone}>{label}</Pill>
      <span className="min-w-0 flex-1 font-mono text-xs break-all">{uri}</span>
    </li>
  );
}
