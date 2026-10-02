"use client";

import { readSse } from "./sse";
import type { OutgoingPart } from "./message-parts";
import type { SendConfig } from "../shared/task-types";

export interface StreamMeta {
  sessionId: string;
  requestId: string;
  protocolVersion: string;
  transport: string;
  negotiatedExtensions: string[];
}

export interface StreamCallbacks {
  onTaskIdentity?: (identity: { localId: string; taskId: string; tenant: string }) => void;
  onMeta?: (meta: StreamMeta) => void;
  onEvent?: (event: unknown) => void;
  onSideband?: (event: unknown) => void;
  onError?: (message: string) => void;
}

/** Drives the server-mediated `message/stream` proxy at /api/agents/[agentId]/stream. */
export async function sendAndStream(
  agentId: string,
  body: {
    text?: string;
    tenant?: string;
    messageId?: string;
    parts?: OutgoingPart[];
    taskId?: string;
    contextId?: string;
    resubscribe?: boolean;
    config?: SendConfig;
  },
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
    else if (event === "persisted") callbacks.onTaskIdentity?.(data as { localId: string; taskId: string; tenant: string });
    else if (event === "a2a") callbacks.onEvent?.(data);
    else if (event === "sideband") callbacks.onSideband?.(data);
    else if (event === "error") {
      const message = (data as { message?: string } | undefined)?.message ?? "Streaming request failed.";
      callbacks.onError?.(message);
      throw new Error(message);
    }
  }
}
