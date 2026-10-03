import { Migration } from "@mikro-orm/migrations";

export class Migration20261003020000_TaskSubscriptions extends Migration {

  name = 'Migration20261003020000_TaskSubscriptions';

  async up() {
    this.addSql(`create table "task_subscriptions" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "status" varchar(32) not null, "available_at" timestamptz not null, "attempts" int not null default 0, "lease_owner" varchar(255) null, "lease_until" timestamptz null, "last_error" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "task_subscriptions" add constraint "uq_task_subscriptions_task" unique ("task_id");`);
    this.addSql(`create index "idx_task_subscriptions_ready" on "task_subscriptions" ("status", "available_at");`);
    this.addSql(`create index "idx_task_subscriptions_lease" on "task_subscriptions" ("lease_until");`);

    this.addSql(`alter table "task_events" add "sequence" serial;`);
    // Historic events receive deterministic feed order. New sequence values are
    // allocated while holding the task projection lock in the ingestion path.
    this.addSql(`update "task_events" e set "sequence" = ordered.n from (select id, row_number() over (order by received_at, id)::int as n from task_events) ordered where ordered.id = e.id;`);
    this.addSql(`select setval(pg_get_serial_sequence('task_events', 'sequence'), greatest(coalesce(max(sequence), 0), 1), count(*) > 0) from task_events;`);
    this.addSql(`create index "idx_task_events_feed" on "task_events" ("task_id", "sequence");`);

    this.addSql(`alter table "task_subscriptions" add constraint "task_subscriptions_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "task_subscriptions" add constraint "task_subscriptions_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);
    // Adopt already-observed active tasks on upgrade without a browser reconnect.
    this.addSql(`insert into task_subscriptions (id, organization_id, task_id, status, available_at, attempts, created_at, updated_at) select id, organization_id, id, 'pending', now(), 0, now(), now() from tasks where kind = 'task' and remote_task_id is not null and state not in ('TASK_STATE_COMPLETED', 'TASK_STATE_FAILED', 'TASK_STATE_CANCELED', 'TASK_STATE_REJECTED', 'TASK_STATE_INPUT_REQUIRED', 'TASK_STATE_AUTH_REQUIRED');`);
  }

  async down() {
    this.addSql(`drop table if exists "task_subscriptions" cascade;`);

    this.addSql(`drop index "idx_task_events_feed";`);
    this.addSql(`alter table "task_events" drop column "sequence";`);
  }

}
