import { Migration } from "@mikro-orm/migrations";

export class Migration20261003000000_TaskContent extends Migration {
  name = "Migration20261003000000_TaskContent";
  async up() {
    this.addSql(`alter table "tasks" add "content_json" jsonb not null default '{}'::jsonb;`);
  }
  async down() {
    this.addSql(`alter table "tasks" drop column "content_json";`);
  }
}
