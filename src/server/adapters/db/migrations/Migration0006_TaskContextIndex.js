import { Migration } from "@mikro-orm/migrations";

// Finds the tasks of one context without scanning the table (the Tasks list context filter and the "other tasks in this
// context" section). An index only: an instance still running the previous release is unaffected during a rolling upgrade.
export class Migration0006_TaskContextIndex extends Migration {
  name = "Migration0006_TaskContextIndex";

  async up() {
    this.addSql(`create index "idx_tasks_context" on "tasks" ("organization_id", "agent_id", "tenant", "remote_context_id");`);
  }

  async down() {
    this.addSql(`drop index "idx_tasks_context";`);
  }
}
