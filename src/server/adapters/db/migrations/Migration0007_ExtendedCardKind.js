import { Migration } from "@mikro-orm/migrations";

export class Migration0007_ExtendedCardKind extends Migration {

  name = 'Migration0007_ExtendedCardKind';

  async up() {
    this.addSql(`alter table "agent_card_snapshots" add "kind" text not null default 'public';`);
  }

  async down() {
    this.addSql(`alter table "agent_card_snapshots" drop column "kind";`);
  }

}

