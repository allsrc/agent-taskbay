import type { EntityManager } from "@mikro-orm/core";
import type { DurableTaskView } from "../../shared/task-types";
import { createPersistenceRepositories } from "../adapters/db/repositories";
import { DecisionError, DecisionService, actionDigest } from "../application/services/decisions";
import { APPROVAL_REQUEST_EXTENSION_URI, findAgentApprovalRequest } from "../application/services/agent-approval";
import type { ArtifactStore } from "../application/ports/artifact-store";
import { decisionPorts } from "./decisions";

/**
 * Runs inside the observation transaction. When an agent that advertises the approval-request extension sends one in its
 * latest INPUT_REQUIRED message, a pending decision request is opened (idempotently, keyed by task and message). Content is
 * validated before any write, so a refusal never disturbs the observation; only infrastructure failures propagate.
 */
export async function openAgentApprovalIfRequested(transaction: EntityManager, organizationId: string, view: DurableTaskView, store?: ArtifactStore) {
  const found = findAgentApprovalRequest(view);
  if (!found) return;
  const snapshot = await createPersistenceRepositories(transaction).agents.findLatestCardSnapshot(view.agentId);
  const card = snapshot?.normalizedCardJson as { capabilities?: { extensions?: Array<{ uri?: unknown }> } } | undefined;
  if (!card?.capabilities?.extensions?.some((extension) => extension.uri === APPROVAL_REQUEST_EXTENSION_URI)) return;
  const ports = decisionPorts(transaction, store);
  try {
    await new DecisionService({ run: (work) => work(ports) }).openFromAgent(ports, { organizationId, taskId: view.localId, // The key names the message and the exact content, so an agent that changes what it asks gets a new request (which supersedes the old one), never a mutation of an existing one.
      requestKey: `agent:${view.localId}:${found.messageId}:${actionDigest(found.request.action).slice(0, 16)}`,
      title: found.request.title, summary: found.request.summary, risk: found.request.risk, action: found.request.action, lifetimeMs: found.request.lifetimeMs });
  } catch (error) {
    // An invalid or conflicting request stays ordinary message content; it must not abort the observation.
    if (!(error instanceof DecisionError)) throw error;
  }
}
