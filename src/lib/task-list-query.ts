export const TASK_PAGE_SIZE = 50;

export interface TaskListView { filter: string; origin?: "discovered"; contextId?: string; agentId?: string; after?: string }

/** The query string for `GET /api/tasks`, from what the Tasks list shows. */
export function taskListQuery(view: TaskListView, limit = TASK_PAGE_SIZE): string {
  const params = new URLSearchParams({ filter: view.filter, limit: String(limit) });
  if (view.origin) params.set("origin", view.origin);
  if (view.contextId) params.set("contextId", view.contextId);
  if (view.agentId) params.set("agentId", view.agentId);
  if (view.after) params.set("after", view.after);
  return params.toString();
}

/** The Tasks list address that shows every task in one context of one agent. */
export function contextListHref(contextId: string, agentId: string): string {
  return `/tasks?${new URLSearchParams({ contextId, agentId }).toString()}`;
}
