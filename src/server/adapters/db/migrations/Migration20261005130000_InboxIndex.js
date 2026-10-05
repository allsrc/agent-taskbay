import { Migration } from "@mikro-orm/migrations";

export class Migration20261005130000_InboxIndex extends Migration {

  name = 'Migration20261005130000_InboxIndex';

  async up() {
    this.addSql(`create index "idx_decision_requests_org_updated" on "decision_requests" ("organization_id", "updated_at");`);
  }

  async down() {
    this.addSql(`drop index "idx_decision_requests_org_updated";`);
  }

}
