"use client";

import { readSse } from "@/lib/sse";

export interface StreamMeta {
  sessionId: string;
  requestId: string;
  protocolVersion: string;
  transport: string;
  negotiatedExtensions: string[];
}

export interface StreamCallbacks {
  onMeta?: (meta: StreamMeta) => void;
  onEvent?: (event: unknown) => void;
  onSideband?: (event: unknown) => void;
  onError?: (message: string) => void;
}

/** Drives the server-mediated `message/stream` proxy at /api/agents/[agentId]/stream. */
export async function sendAndStream(
  agentId: string,
  body: { text?: string; taskId?: string; contextId?: string; resubscribe?: boolean },
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/agents/${agentId}/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  for await (const { event, data } of readSse(response, signal)) {
    if (event === "meta") callbacks.onMeta?.(data as StreamMeta);
    else if (event === "a2a") callbacks.onEvent?.(data);
    else if (event === "sideband") callbacks.onSideband?.(data);
    else if (event === "error") callbacks.onError?.((data as { message?: string } | undefined)?.message ?? "Streaming request failed.");
  }
}
