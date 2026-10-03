import { Migration } from "@mikro-orm/migrations";

export class Migration20261003060000_ApplicationFreshness extends Migration {
  name = "Migration20261003060000_ApplicationFreshness";
  async up() {
    this.addSql(`create table "organization_freshness" ("organization_id" uuid not null, "token" uuid not null, primary key ("organization_id"));`);
    this.addSql(`alter table "organization_freshness" add constraint "organization_freshness_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id") on update cascade on delete cascade;`);
  }
  async down() {
    this.addSql(`delete from "outbox_messages" where "topic" = 'task.freshness';`);
    this.addSql(`drop table if exists "organization_freshness" cascade;`);
  }
}
