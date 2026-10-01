import { Migration } from "@mikro-orm/migrations";

export class Migration20261001000000_Baseline extends Migration {
  name = "Migration20261001000000_Baseline";

  up() {
    // Slice 1.1 establishes migration tracking before Slice 1.2 adds domain
    // entities. Keeping this baseline schema-neutral preserves that boundary.
    this.addSql("select 1");
  }

  down() {
    this.addSql("select 1");
  }
}
