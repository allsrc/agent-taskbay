import { Migration } from "@mikro-orm/migrations";

// An administrator can give a registration its own name, to tell apart agents whose cards advertise the same name.
// Nullable, so an instance on the previous release keeps working against this schema.
export class Migration0009_AgentNickname extends Migration {
  name = "Migration0009_AgentNickname";

  async up() {
    this.addSql(`alter table "agents" add "nickname" varchar(100) null;`);
  }

  async down() {
    this.addSql(`alter table "agents" drop column "nickname";`);
  }
}
