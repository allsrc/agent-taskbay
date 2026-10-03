import { Migration } from "@mikro-orm/migrations";

export class Migration20261003045027_TaskReconciliation extends Migration {

  name = 'Migration20261003045027_TaskReconciliation';

  async up() {
    this.addSql(`create table "sync_cursors" ("id" uuid not null, "organization_id" uuid not null, "agent_id" uuid not null, "tenant" varchar(255) not null, "resource_key" varchar(36) not null, "task_id" uuid null, "status" varchar(32) not null, "page_token" text not null, "available_at" timestamptz not null, "attempts" int not null default 0, "lease_owner" varchar(255) null, "lease_until" timestamptz null, "last_error" text null, "last_synced_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_sync_cursors_ready" on "sync_cursors" ("status", "available_at");`);
    this.addSql(`create index "idx_sync_cursors_lease" on "sync_cursors" ("lease_until");`);
    this.addSql(`alter table "sync_cursors" add constraint "uq_sync_cursors_scope_resource" unique ("organization_id", "agent_id", "tenant", "resource_key");`);

    this.addSql(`alter table "sync_cursors" add constraint "sync_cursors_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "sync_cursors" add constraint "sync_cursors_agent_id_foreign" foreign key ("agent_id") references "agents" ("id");`);
    this.addSql(`alter table "sync_cursors" add constraint "sync_cursors_task_id_foreign" foreign key ("task_id") references "tasks" ("id") on delete set null;`);
    // Adopt known work without requiring browser activity. Direct Messages and
    // terminal tasks never become reconciliation reads.
    this.addSql(`insert into sync_cursors (id, organization_id, agent_id, tenant, resource_key, task_id, status, page_token, available_at, attempts, created_at, updated_at) select id, organization_id, agent_id, tenant, id::text, id, 'pending', '', now(), 0, now(), now() from tasks where kind = 'task' and remote_task_id is not null and terminal_at is null and state not in ('TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED');`);
    this.addSql(`insert into sync_cursors (id, organization_id, agent_id, tenant, resource_key, status, page_token, available_at, attempts, created_at, updated_at) select gen_random_uuid(), organization_id, agent_id, tenant, '', 'pending', '', now(), 0, now(), now() from tasks where kind = 'task' and remote_task_id is not null and terminal_at is null and state not in ('TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED') group by organization_id, agent_id, tenant;`);
  }

  async down() {
    this.addSql(`drop table if exists "sync_cursors" cascade;`);
  }

}

