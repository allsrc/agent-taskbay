import { Migration } from "@mikro-orm/migrations";

// An administrator can allow sending to an agent whose card requires an extension Taskbay does not support.
// Defaulted, so an instance on the previous release keeps working against this schema.
export class Migration0004_AgentExtensionOverride extends Migration {
  name = "Migration0004_AgentExtensionOverride";

  async up() {
    this.addSql(`alter table "agents" add "extension_override" boolean not null default false;`);
  }

  async down() {
    this.addSql(`alter table "agents" drop column "extension_override";`);
  }
}
