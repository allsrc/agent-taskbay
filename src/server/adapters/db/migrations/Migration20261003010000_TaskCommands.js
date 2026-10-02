import { Migration } from "@mikro-orm/migrations";

export class Migration20261003010000_TaskCommands extends Migration {

  name = 'Migration20261003010000_TaskCommands';

  async up() {
    this.addSql(`create table "task_commands" ("id" uuid not null, "organization_id" uuid not null, "agent_id" uuid not null, "tenant" varchar(255) not null, "action" varchar(32) not null, "idempotency_key" varchar(255) not null, "message_id" varchar(255) not null, "payload_digest" varchar(64) not null, "payload_object_key" text not null, "status" varchar(32) not null, "result_json" jsonb null, "last_error" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_task_commands_org_created" on "task_commands" ("organization_id", "created_at");`);
    this.addSql(`alter table "task_commands" add constraint "uq_task_commands_org_key" unique ("organization_id", "idempotency_key");`);

    this.addSql(`alter table "task_commands" add constraint "task_commands_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "task_commands" add constraint "task_commands_agent_id_foreign" foreign key ("agent_id") references "agents" ("id");`);
  }

  async down() {
    this.addSql(`drop table if exists "task_commands" cascade;`);
  }

}
