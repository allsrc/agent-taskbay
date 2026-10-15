import { Migration } from "@mikro-orm/migrations";

// Where an automatic discovery sweep is, so it can span several pages and several workers: when it began, how many tasks it has stored,
// and the time filter it uses. Nullable or defaulted, so an instance on the previous release keeps working against this schema.
export class Migration0005_DiscoverySweepProgress extends Migration {
  name = "Migration0005_DiscoverySweepProgress";

  async up() {
    this.addSql(`alter table "sync_cursors" add "sweep_started_at" timestamptz null, add "sweep_found" int not null default 0, add "sweep_after" timestamptz null;`);
  }

  async down() {
    this.addSql(`alter table "sync_cursors" drop column "sweep_started_at", drop column "sweep_found", drop column "sweep_after";`);
  }
}
