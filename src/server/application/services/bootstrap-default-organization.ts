import { randomUUID } from "node:crypto";

import type { Clock } from "../ports/clock";
import type { OrganizationRepository } from "../ports/persistence";

export const DEFAULT_LOCAL_ORGANIZATION = {
  slug: "local",
  name: "Local",
} as const;

const systemClock: Clock = {
  now: () => new Date(),
};

export async function bootstrapDefaultLocalOrganization(
  organizations: OrganizationRepository,
  clock: Clock = systemClock,
  createId: () => string = randomUUID,
) {
  const now = clock.now();
  return organizations.getOrCreate({
    id: createId(),
    ...DEFAULT_LOCAL_ORGANIZATION,
    createdAt: now,
    updatedAt: now,
  });
}
