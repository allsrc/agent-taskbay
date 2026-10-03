import { Migration } from "@mikro-orm/migrations";

export class Migration20261003030000_TaskPushRegistrations extends Migration {

  name = 'Migration20261003030000_TaskPushRegistrations';

  async up() {
    this.addSql(`create table "task_push_registrations" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "status" varchar(32) not null, "desired" boolean not null, "available_at" timestamptz not null, "attempts" int not null default 0, "lease_owner" varchar(255) null, "lease_until" timestamptz null, "last_error" text null, "rate_window" timestamptz not null, "rate_count" int not null default 0, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "task_push_registrations" add constraint "uq_task_push_registrations_task" unique ("task_id");`);
    this.addSql(`create index "idx_task_push_registrations_ready" on "task_push_registrations" ("status", "available_at");`);
    this.addSql(`create index "idx_task_push_registrations_lease" on "task_push_registrations" ("lease_until");`);

    this.addSql(`alter table "task_push_registrations" add constraint "task_push_registrations_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "task_push_registrations" add constraint "task_push_registrations_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);
  }

  async down() {
    this.addSql(`drop table if exists "task_push_registrations" cascade;`);
  }

}
