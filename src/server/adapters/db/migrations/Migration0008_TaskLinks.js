import { Migration } from "@mikro-orm/migrations";

export class Migration0008_TaskLinks extends Migration {

  name = 'Migration0008_TaskLinks';

  async up() {
    this.addSql(`create table "task_links" ("id" uuid not null, "organization_id" uuid not null, "from_task_id" uuid not null, "to_task_id" uuid not null, "kind" text not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_task_links_to_task" on "task_links" ("to_task_id");`);
    this.addSql(`alter table "task_links" add constraint "uq_task_links_reference" unique ("from_task_id", "to_task_id", "kind");`);

    this.addSql(`alter table "task_links" add constraint "task_links_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "task_links" add constraint "task_links_from_task_id_foreign" foreign key ("from_task_id") references "tasks" ("id");`);
    this.addSql(`alter table "task_links" add constraint "task_links_to_task_id_foreign" foreign key ("to_task_id") references "tasks" ("id");`);
  }

  async down() {
    this.addSql(`drop table if exists "task_links" cascade;`);
  }

}

