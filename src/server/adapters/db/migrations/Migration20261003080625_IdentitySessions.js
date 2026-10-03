import { Migration } from "@mikro-orm/migrations";

export class Migration20261003080625_IdentitySessions extends Migration {

  name = 'Migration20261003080625_IdentitySessions';

  async up() {
    this.addSql(`create table "login_attempts" ("token_hash" varchar(64) not null, "encrypted_flow" text not null, "expires_at" timestamptz not null, primary key ("token_hash"));`);
    this.addSql(`create index "idx_login_attempts_expiry" on "login_attempts" ("expires_at");`);

    this.addSql(`create table "users" ("id" uuid not null, "display_name" varchar(200) not null, "enabled" boolean not null, "created_at" timestamptz not null, primary key ("id"));`);

    this.addSql(`create table "security_audit_events" ("id" uuid not null, "organization_id" uuid not null, "actor_user_id" uuid null, "actor_type" varchar(32) not null, "action" varchar(100) not null, "target_id" text not null, "event_key" text not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "security_audit_events" add constraint "uq_security_audit_event_key" unique ("event_key");`);
    this.addSql(`create index "idx_security_audit_org_time" on "security_audit_events" ("organization_id", "created_at");`);

    this.addSql(`create table "memberships" ("id" uuid not null, "organization_id" uuid not null, "user_id" uuid not null, "role" varchar(32) not null, "enabled" boolean not null, primary key ("id"));`);
    this.addSql(`alter table "memberships" add constraint "uq_membership_org_user" unique ("organization_id", "user_id");`);

    this.addSql(`create table "external_identities" ("id" uuid not null, "user_id" uuid not null, "issuer" varchar(1024) not null, "subject" varchar(255) not null, primary key ("id"));`);
    this.addSql(`alter table "external_identities" add constraint "uq_external_identity_issuer_subject" unique ("issuer", "subject");`);

    this.addSql(`create table "user_sessions" ("token_hash" varchar(64) not null, "membership_id" uuid not null, "expires_at" timestamptz not null, "created_at" timestamptz not null, primary key ("token_hash"));`);
    this.addSql(`create index "idx_user_sessions_expiry" on "user_sessions" ("expires_at");`);

    this.addSql(`alter table "security_audit_events" add constraint "security_audit_events_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "security_audit_events" add constraint "security_audit_events_actor_user_id_foreign" foreign key ("actor_user_id") references "users" ("id");`);

    this.addSql(`alter table "memberships" add constraint "memberships_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "memberships" add constraint "memberships_user_id_foreign" foreign key ("user_id") references "users" ("id");`);

    this.addSql(`alter table "external_identities" add constraint "external_identities_user_id_foreign" foreign key ("user_id") references "users" ("id");`);

    this.addSql(`alter table "user_sessions" add constraint "user_sessions_membership_id_foreign" foreign key ("membership_id") references "memberships" ("id");`);
  }

  async down() {
    this.addSql(`alter table "security_audit_events" drop constraint "security_audit_events_actor_user_id_foreign";`);
    this.addSql(`alter table "memberships" drop constraint "memberships_user_id_foreign";`);
    this.addSql(`alter table "external_identities" drop constraint "external_identities_user_id_foreign";`);
    this.addSql(`alter table "user_sessions" drop constraint "user_sessions_membership_id_foreign";`);

    this.addSql(`drop table if exists "login_attempts" cascade;`);
    this.addSql(`drop table if exists "users" cascade;`);
    this.addSql(`drop table if exists "security_audit_events" cascade;`);
    this.addSql(`drop table if exists "memberships" cascade;`);
    this.addSql(`drop table if exists "external_identities" cascade;`);
    this.addSql(`drop table if exists "user_sessions" cascade;`);
  }

}
