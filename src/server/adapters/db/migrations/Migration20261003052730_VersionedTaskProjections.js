import { Migration } from "@mikro-orm/migrations";

export class Migration20261003052730_VersionedTaskProjections extends Migration {

  name = 'Migration20261003052730_VersionedTaskProjections';

  async up() {
    this.addSql(`create table "message_projections" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "projection_version" int not null, "remote_message_id" text not null, "position" int not null, "content_json" jsonb not null, primary key ("id"));`);
    this.addSql(`alter table "message_projections" add constraint "uq_message_projections_identity" unique ("task_id", "projection_version", "remote_message_id");`);

    this.addSql(`create table "artifact_projections" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "projection_version" int not null, "remote_artifact_id" text not null, "position" int not null, "content_json" jsonb not null, primary key ("id"));`);
    this.addSql(`alter table "artifact_projections" add constraint "uq_artifact_projections_identity" unique ("task_id", "projection_version", "remote_artifact_id");`);

    this.addSql(`create table "task_projections" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "projection_version" int not null, "header_json" jsonb not null, primary key ("id"));`);
    this.addSql(`alter table "task_projections" add constraint "uq_task_projections_identity" unique ("task_id", "projection_version");`);

    this.addSql(`alter table "tasks" add "projection_version" int not null default 1;`);

    this.addSql(`alter table "message_projections" add constraint "message_projections_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "message_projections" add constraint "message_projections_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);

    this.addSql(`alter table "artifact_projections" add constraint "artifact_projections_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "artifact_projections" add constraint "artifact_projections_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);

    this.addSql(`alter table "task_projections" add constraint "task_projections_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "task_projections" add constraint "task_projections_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);
  }

  async down() {
    // Export the active generation before removing the versioned schema.
    this.addSql(`update tasks t set content_json = p.header_json || jsonb_build_object(
      'messages', coalesce((select jsonb_agg(m.content_json order by m.position) from message_projections m where m.task_id = t.id and m.organization_id = t.organization_id and m.projection_version = t.projection_version), '[]'::jsonb),
      'artifacts', coalesce((select jsonb_agg(a.content_json order by a.position) from artifact_projections a where a.task_id = t.id and a.organization_id = t.organization_id and a.projection_version = t.projection_version), '[]'::jsonb)
    ) from task_projections p where p.task_id = t.id and p.organization_id = t.organization_id and p.projection_version = t.projection_version;`);

    this.addSql(`drop table if exists "message_projections" cascade;`);
    this.addSql(`drop table if exists "artifact_projections" cascade;`);
    this.addSql(`drop table if exists "task_projections" cascade;`);

    this.addSql(`alter table "tasks" drop column "projection_version";`);
  }

}
