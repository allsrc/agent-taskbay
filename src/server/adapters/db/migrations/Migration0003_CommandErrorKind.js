import { Migration } from "@mikro-orm/migrations";

// Why an agent refused a command (`rejected` status). Nullable, so an instance on the previous release keeps working.
export class Migration0003_CommandErrorKind extends Migration {
  name = "Migration0003_CommandErrorKind";

  async up() {
    this.addSql(`alter table "task_commands" add "error_kind" varchar(64) null;`);
  }

  async down() {
    this.addSql(`alter table "task_commands" drop column "error_kind";`);
  }
}
