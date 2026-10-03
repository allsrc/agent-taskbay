import { AsyncLocalStorage } from "node:async_hooks";
import type { Principal } from "../../application/ports/identity";

// Shared across independently bundled Next routes, with isolation per async request.
const scope = globalThis as typeof globalThis & { __a2aPrincipal?: AsyncLocalStorage<Principal> };
const storage = scope.__a2aPrincipal ??= new AsyncLocalStorage<Principal>();
export const currentPrincipal = () => storage.getStore();
export function withPrincipal<T>(principal: Principal, work: () => T): T {
  return storage.run(principal, work);
}
