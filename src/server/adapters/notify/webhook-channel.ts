import { createHmac } from "node:crypto";
import type { NotificationChannel } from "../../application/ports/notifications";
import { createSafeFetch } from "../../../lib/safe-fetch";
import { validateTargetUrl } from "../../../lib/url-safety";

export interface WebhookConfig { url: string; secret: string; organizationSlug: string }

/** Reads the optional external channel. Absent means in-app notifications only. */
export function loadNotifyConfig(environment: Readonly<Record<string, string | undefined>> = process.env): { webhook?: WebhookConfig } {
  const url = environment.A2A_NOTIFY_WEBHOOK_URL?.trim();
  if (!url) return {};
  const secret = environment.A2A_NOTIFY_WEBHOOK_SECRET ?? "";
  if (secret.length < 32) throw new Error("A2A_NOTIFY_WEBHOOK_SECRET must be at least 32 characters when A2A_NOTIFY_WEBHOOK_URL is set.");
  // The same exact-origin allowlist, HTTPS and network rules as agents apply to this destination.
  validateTargetUrl(url);
  return { webhook: { url, secret, organizationSlug: environment.A2A_NOTIFY_WEBHOOK_ORGANIZATION?.trim() || "local" } };
}

/**
 * Posts a signed JSON message (Slack-compatible `text` included) to one configured URL for one organization. Delivery is
 * at least once: receivers deduplicate on `X-A2A-Ops-Delivery`. Only titles the console already shows are sent.
 */
export class WebhookChannel implements NotificationChannel {
  readonly name = "webhook";
  constructor(private readonly config: WebhookConfig, private readonly publicOrigin: string | undefined = process.env.A2A_AUTH_ORIGIN) {}

  enabledFor(_organizationId: string, organizationSlug: string) { return organizationSlug === this.config.organizationSlug; }
  get host() { return new URL(this.config.url).host; }

  async send({ notification, organizationSlug, recipients, signal }: Parameters<NotificationChannel["send"]>[0]) {
    validateTargetUrl(this.config.url);
    const link = this.publicOrigin ? new URL(notification.link, this.publicOrigin).href : notification.link;
    const body = JSON.stringify({ id: notification.id, kind: notification.kind, organization: organizationSlug, title: notification.title, body: notification.body,
      text: `${notification.title}: ${notification.body}${this.publicOrigin ? ` ${link}` : ""}`, link, createdAt: notification.createdAt.toISOString(), recipients });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", this.config.secret).update(`${timestamp}.${body}`).digest("hex");
    const fetcher = createSafeFetch({ auth: { type: "none" }, headers: {}, telemetry: [], timeoutMs: 10_000 });
    let response: Response;
    try {
      response = await fetcher(this.config.url, { method: "POST", signal, body, headers: { "Content-Type": "application/json", "X-A2A-Ops-Delivery": notification.id,
        "X-A2A-Ops-Timestamp": timestamp, "X-A2A-Ops-Signature": `v1=${signature}` } });
    } catch { throw new Error("Webhook request failed."); }
    await response.body?.cancel().catch(() => undefined);
    if (!response.ok) throw new Error(`Webhook responded with ${response.status}.`);
  }
}
