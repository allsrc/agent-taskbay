import { Migration } from "@mikro-orm/migrations";

export class Migration20261003100926_ScopedSecurity extends Migration {

  name = 'Migration20261003100926_ScopedSecurity';

  async up() {
    this.addSql(`create table "artifact_access" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "digest" varchar(64) not null, primary key ("id"));`);
    this.addSql(`alter table "artifact_access" add constraint "uq_artifact_access_task_digest" unique ("task_id", "digest");`);
    this.addSql(`create index "idx_artifact_access_org_digest" on "artifact_access" ("organization_id", "digest");`);
    this.addSql(`alter table "artifact_access" add constraint "artifact_access_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "artifact_access" add constraint "artifact_access_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);

    this.addSql(`create table "agent_credentials" ("id" uuid not null, "organization_id" uuid not null, "agent_id" uuid not null, "kind" varchar(32) not null, "ciphertext" text not null, "key_id" varchar(64) not null, "enabled" boolean not null, "revision" int not null default 1, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "agent_credentials" add constraint "uq_agent_credential_binding" unique ("organization_id", "agent_id");`);

    this.addSql(`create table "access_grants" ("id" uuid not null, "organization_id" uuid not null, "subject_type" varchar(32) not null, "subject_id" uuid not null, "agent_id" uuid not null, "skill_id" varchar(255) null, "permission" varchar(32) not null, "enabled" boolean not null, primary key ("id"));`);
    this.addSql(`create index "idx_access_grant_subject" on "access_grants" ("organization_id", "subject_type", "subject_id");`);

    this.addSql(`create table "security_rate_buckets" ("id" varchar(150) not null, "count" int not null, "expires_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_security_rate_expiry" on "security_rate_buckets" ("expires_at");`);

    this.addSql(`create table "teams" ("id" uuid not null, "organization_id" uuid not null, "name" varchar(200) not null, "enabled" boolean not null, primary key ("id"));`);

    this.addSql(`create table "team_memberships" ("id" uuid not null, "team_id" uuid not null, "membership_id" uuid not null, primary key ("id"));`);
    this.addSql(`alter table "team_memberships" add constraint "uq_team_membership" unique ("team_id", "membership_id");`);

    this.addSql(`alter table "task_commands" add "skill_id" varchar(255) null;`);

    this.addSql(`alter table "tasks" add "skill_id" varchar(255) null;`);

    this.addSql(`alter table "agent_credentials" add constraint "agent_credentials_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "agent_credentials" add constraint "agent_credentials_agent_id_foreign" foreign key ("agent_id") references "agents" ("id");`);

    this.addSql(`alter table "access_grants" add constraint "access_grants_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "access_grants" add constraint "access_grants_agent_id_foreign" foreign key ("agent_id") references "agents" ("id");`);

    this.addSql(`alter table "teams" add constraint "teams_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);

    this.addSql(`alter table "team_memberships" add constraint "team_memberships_team_id_foreign" foreign key ("team_id") references "teams" ("id");`);
    this.addSql(`alter table "team_memberships" add constraint "team_memberships_membership_id_foreign" foreign key ("membership_id") references "memberships" ("id");`);
  }

  async down() {
    this.addSql(`drop table if exists "artifact_access" cascade;`);
    this.addSql(`alter table "team_memberships" drop constraint "team_memberships_team_id_foreign";`);

    this.addSql(`drop table if exists "agent_credentials" cascade;`);
    this.addSql(`drop table if exists "access_grants" cascade;`);
    this.addSql(`drop table if exists "security_rate_buckets" cascade;`);
    this.addSql(`drop table if exists "teams" cascade;`);
    this.addSql(`drop table if exists "team_memberships" cascade;`);

    this.addSql(`alter table "task_commands" drop column "skill_id";`);

    this.addSql(`alter table "tasks" drop column "skill_id";`);
  }

}
