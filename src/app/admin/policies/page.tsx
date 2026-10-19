"use client";

import { Page } from "@/components/console/page";
import { EscalationSettings } from "@/components/escalation-settings";
import { NotificationChannelSettings } from "@/components/notification-channel-settings";

export default function PoliciesPage() {
  return (
    <Page title="Policies & alerts" description="Where overdue work goes, and the external channel that receives every notification.">
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <EscalationSettings />
        <NotificationChannelSettings />
      </div>
    </Page>
  );
}
