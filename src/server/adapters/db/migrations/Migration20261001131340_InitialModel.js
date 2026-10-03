import { Migration } from "@mikro-orm/migrations";

export class Migration20261001131340_InitialModel extends Migration {

  name = 'Migration20261001131340_InitialModel';

  async up() {
    this.addSql(`create table "organizations" ("id" uuid not null, "slug" varchar(100) not null, "name" varchar(200) not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "organizations" add constraint "uq_organizations_slug" unique ("slug");`);

    this.addSql(`create table "agents" ("id" uuid not null, "organization_id" uuid not null, "card_url" varchar(1024) not null, "source" varchar(32) not null, "enabled" boolean not null, "display_name" varchar(300) null, "description" text null, "protocol_snapshot_version" varchar(100) null, "last_discovery_at" timestamptz null, "last_healthy_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_agents_organization" on "agents" ("organization_id");`);
    this.addSql(`alter table "agents" add constraint "uq_agents_organization_card_url" unique ("organization_id", "card_url");`);

    this.addSql(`create table "agent_card_snapshots" ("id" uuid not null, "agent_id" uuid not null, "fetched_at" timestamptz not null, "resolved_card_url" varchar(1024) null, "raw_card_json" jsonb not null, "normalized_card_json" jsonb not null, "compliance_json" jsonb not null, "signature_status" varchar(64) not null, "digest" varchar(64) not null, primary key ("id"));`);
    this.addSql(`create index "idx_agent_card_snapshots_agent_fetched" on "agent_card_snapshots" ("agent_id", "fetched_at");`);

    this.addSql(`create table "outbox_messages" ("id" uuid not null, "organization_id" uuid not null, "topic" varchar(255) not null, "aggregate_type" varchar(100) not null, "aggregate_id" uuid not null, "payload_json" jsonb not null, "available_at" timestamptz not null, "attempts" int not null default 0, "status" varchar(32) not null, "lease_owner" varchar(255) null, "lease_until" timestamptz null, "last_error" text null, "created_at" timestamptz not null, "processed_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "idx_outbox_messages_ready" on "outbox_messages" ("status", "available_at");`);
    this.addSql(`create index "idx_outbox_messages_lease" on "outbox_messages" ("lease_until");`);
    this.addSql(`create index "idx_outbox_messages_aggregate" on "outbox_messages" ("aggregate_type", "aggregate_id");`);

    this.addSql(`create table "tasks" ("id" uuid not null, "organization_id" uuid not null, "agent_id" uuid not null, "tenant" varchar(255) not null, "remote_task_id" varchar(512) null, "remote_context_id" varchar(512) null, "kind" varchar(64) not null, "state" varchar(64) not null, "title" varchar(500) null, "owner_user_id" uuid null, "owner_team_id" uuid null, "created_at" timestamptz not null, "remote_created_at" timestamptz null, "updated_at" timestamptz not null, "remote_updated_at" timestamptz null, "terminal_at" timestamptz null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`create index "idx_tasks_organization_updated" on "tasks" ("organization_id", "updated_at");`);
    this.addSql(`create index "idx_tasks_organization_state" on "tasks" ("organization_id", "state");`);
    this.addSql(`alter table "tasks" add constraint "uq_tasks_remote_identity" unique ("agent_id", "tenant", "remote_task_id");`);

    this.addSql(`create table "task_events" ("id" uuid not null, "organization_id" uuid not null, "agent_id" uuid not null, "task_id" uuid not null, "source" varchar(32) not null, "event_kind" varchar(100) not null, "received_at" timestamptz not null, "remote_timestamp" timestamptz null, "source_key" varchar(512) not null, "payload_digest" varchar(64) not null, "payload_json" jsonb not null, "session_id" varchar(255) null, "request_id" varchar(255) null, "trace_id" varchar(255) null, "projection_version" int not null, primary key ("id"));`);
    this.addSql(`create index "idx_task_events_task_received" on "task_events" ("task_id", "received_at");`);
    this.addSql(`create index "idx_task_events_organization_received" on "task_events" ("organization_id", "received_at");`);
    this.addSql(`alter table "task_events" add constraint "uq_task_events_source_key" unique ("task_id", "source", "source_key");`);

    this.addSql(`alter table "agents" add constraint "agents_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);

    this.addSql(`alter table "agent_card_snapshots" add constraint "agent_card_snapshots_agent_id_foreign" foreign key ("agent_id") references "agents" ("id");`);

    this.addSql(`alter table "outbox_messages" add constraint "outbox_messages_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);

    this.addSql(`alter table "tasks" add constraint "tasks_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "tasks" add constraint "tasks_agent_id_foreign" foreign key ("agent_id") references "agents" ("id");`);

    this.addSql(`alter table "task_events" add constraint "task_events_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "task_events" add constraint "task_events_agent_id_foreign" foreign key ("agent_id") references "agents" ("id");`);
    this.addSql(`alter table "task_events" add constraint "task_events_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);
  }

  async down() {
    this.addSql(`alter table "agents" drop constraint "agents_organization_id_foreign";`);
    this.addSql(`alter table "outbox_messages" drop constraint "outbox_messages_organization_id_foreign";`);
    this.addSql(`alter table "tasks" drop constraint "tasks_organization_id_foreign";`);
    this.addSql(`alter table "task_events" drop constraint "task_events_organization_id_foreign";`);
    this.addSql(`alter table "agent_card_snapshots" drop constraint "agent_card_snapshots_agent_id_foreign";`);
    this.addSql(`alter table "tasks" drop constraint "tasks_agent_id_foreign";`);
    this.addSql(`alter table "task_events" drop constraint "task_events_agent_id_foreign";`);
    this.addSql(`alter table "task_events" drop constraint "task_events_task_id_foreign";`);

    this.addSql(`drop table if exists "organizations" cascade;`);
    this.addSql(`drop table if exists "agents" cascade;`);
    this.addSql(`drop table if exists "agent_card_snapshots" cascade;`);
    this.addSql(`drop table if exists "outbox_messages" cascade;`);
    this.addSql(`drop table if exists "tasks" cascade;`);
    this.addSql(`drop table if exists "task_events" cascade;`);
  }

}
