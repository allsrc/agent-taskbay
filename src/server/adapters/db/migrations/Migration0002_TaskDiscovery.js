import { Migration } from "@mikro-orm/migrations";

// Where a task came from and how each agent's tasks are discovered. Every column is nullable or has a default,
// so an instance still running the previous release keeps working against this schema during a rolling upgrade.
export class Migration0002_TaskDiscovery extends Migration {
  name = "Migration0002_TaskDiscovery";

  async up() {
    this.addSql(`alter table "agents" add "task_discovery" varchar(16) not null default 'browse', add "task_discovery_history_days" int not null default 7, add "task_discovery_paused_reason" text null;`);

    this.addSql(`alter table "tasks" add "origin" varchar(16) not null default 'created', add "discovered_at" timestamptz null, add "tracked_by_user_id" uuid null;`);
    this.addSql(`create index "idx_tasks_origin" on "tasks" ("organization_id", "agent_id", "origin");`);

    this.addSql(`alter table "sync_cursors" add "last_full_sweep_at" timestamptz null;`);
  }

  async down() {
    this.addSql(`alter table "agents" drop column "task_discovery", drop column "task_discovery_history_days", drop column "task_discovery_paused_reason";`);

    this.addSql(`alter table "sync_cursors" drop column "last_full_sweep_at";`);

    this.addSql(`drop index "idx_tasks_origin";`);
    this.addSql(`alter table "tasks" drop column "origin", drop column "discovered_at", drop column "tracked_by_user_id";`);
  }
}
