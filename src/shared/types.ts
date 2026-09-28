import type { NormalizedPart } from "@/lib/types";

export interface TaskReferences {
  contextId?: string;
  taskId?: string;
  messageId?: string;
  artifactId?: string;
  traceId?: string;
  spanId?: string;
}

export type SidebandLevel = "debug" | "info" | "warning" | "error";

export interface SidebandEvent {
  id: string;
  sessionId: string;
  requestId: string;
  timestamp: string;
  extensionUri: string;
  type: string;
  title: string;
  level: SidebandLevel;
  parts: NormalizedPart[];
  metadata?: Record<string, unknown>;
  references?: TaskReferences;
}
