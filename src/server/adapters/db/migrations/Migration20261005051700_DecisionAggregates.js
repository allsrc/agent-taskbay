import { Migration } from "@mikro-orm/migrations";

export class Migration20261005051700_DecisionAggregates extends Migration {

  name = 'Migration20261005051700_DecisionAggregates';

  async up() {
    this.addSql(`create table "decision_requests" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "agent_id" uuid not null, "tenant" varchar(255) not null, "skill_id" varchar(255) null, "kind" varchar(64) not null, "status" varchar(32) not null, "request_key" varchar(255) not null, "title" varchar(300) not null, "summary" text not null, "risk" varchar(16) not null, "policy_json" jsonb not null, "requester_user_id" uuid null, "assigned_membership_id" uuid null, "current_revision" int not null, "expires_at" timestamptz not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`create index "idx_decision_requests_org_status" on "decision_requests" ("organization_id", "status", "expires_at");`);
    this.addSql(`create index "idx_decision_requests_task" on "decision_requests" ("task_id");`);
    this.addSql(`create index "idx_decision_requests_assignee" on "decision_requests" ("organization_id", "assigned_membership_id", "status");`);
    this.addSql(`alter table "decision_requests" add constraint "uq_decision_requests_org_key" unique ("organization_id", "request_key");`);

    this.addSql(`create table "decision_revisions" ("id" uuid not null, "organization_id" uuid not null, "request_id" uuid not null, "number" int not null, "action_json" jsonb not null, "digest" varchar(64) not null, "author_type" varchar(16) not null, "author_user_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "decision_revisions" add constraint "uq_decision_revisions_request_number" unique ("request_id", "number");`);

    this.addSql(`create table "decisions" ("id" uuid not null, "organization_id" uuid not null, "request_id" uuid not null, "revision_id" uuid not null, "revision_digest" varchar(64) not null, "outcome" varchar(32) not null, "rationale" text not null, "reviewer_user_id" uuid not null, "reviewer_membership_id" uuid not null, "delegate_membership_id" uuid null, "idempotency_key" varchar(255) not null, "input_digest" varchar(64) not null, "policy_json" jsonb not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_decisions_request" on "decisions" ("request_id", "created_at");`);
    this.addSql(`alter table "decisions" add constraint "uq_decisions_org_key" unique ("organization_id", "idempotency_key");`);

    this.addSql(`create table "decision_executions" ("id" uuid not null, "organization_id" uuid not null, "decision_id" uuid not null, "revision_id" uuid not null, "revision_digest" varchar(64) not null, "command_id" uuid not null, "message_id" varchar(255) not null, "status" varchar(32) not null, "observed_task_state" varchar(64) null, "observed_at" timestamptz null, "last_error" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "decision_executions" add constraint "uq_decision_executions_decision" unique ("decision_id");`);
    this.addSql(`alter table "decision_executions" add constraint "uq_decision_executions_command" unique ("command_id");`);

    this.addSql(`alter table "decision_requests" add constraint "decision_requests_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "decision_requests" add constraint "decision_requests_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);
    this.addSql(`alter table "decision_requests" add constraint "decision_requests_agent_id_foreign" foreign key ("agent_id") references "agents" ("id");`);

    this.addSql(`alter table "decision_revisions" add constraint "decision_revisions_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "decision_revisions" add constraint "decision_revisions_request_id_foreign" foreign key ("request_id") references "decision_requests" ("id");`);
    this.addSql(`create or replace function "decision_revisions_trg_decision_revisions_immutable_fn"() returns trigger as \$\$ begin raise exception 'decision records are immutable' using errcode = '23000'; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_decision_revisions_immutable" BEFORE UPDATE OR DELETE on "decision_revisions" for each ROW execute function "decision_revisions_trg_decision_revisions_immutable_fn"();`);

    this.addSql(`alter table "decisions" add constraint "decisions_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "decisions" add constraint "decisions_request_id_foreign" foreign key ("request_id") references "decision_requests" ("id");`);
    this.addSql(`alter table "decisions" add constraint "decisions_revision_id_foreign" foreign key ("revision_id") references "decision_revisions" ("id");`);
    this.addSql(`alter table "decisions" add constraint "decisions_reviewer_user_id_foreign" foreign key ("reviewer_user_id") references "users" ("id") on delete no action;`);
    this.addSql(`create or replace function "decisions_trg_decisions_immutable_fn"() returns trigger as \$\$ begin raise exception 'decision records are immutable' using errcode = '23000'; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_decisions_immutable" BEFORE UPDATE OR DELETE on "decisions" for each ROW execute function "decisions_trg_decisions_immutable_fn"();`);

    this.addSql(`alter table "decision_executions" add constraint "decision_executions_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "decision_executions" add constraint "decision_executions_decision_id_foreign" foreign key ("decision_id") references "decisions" ("id");`);
    this.addSql(`alter table "decision_executions" add constraint "decision_executions_revision_id_foreign" foreign key ("revision_id") references "decision_revisions" ("id");`);
    this.addSql(`alter table "decision_executions" add constraint "decision_executions_command_id_foreign" foreign key ("command_id") references "task_commands" ("id");`);
    this.addSql(`create or replace function "decision_executions_trg_decision_executions_guard_fn"() returns trigger as \$\$ begin if tg_op = 'DELETE' or new.decision_id <> old.decision_id or new.revision_id <> old.revision_id or new.revision_digest <> old.revision_digest or new.command_id <> old.command_id or new.message_id <> old.message_id or new.organization_id <> old.organization_id then raise exception 'decision execution correlation is immutable' using errcode = '23000'; end if; return new; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_decision_executions_guard" BEFORE UPDATE OR DELETE on "decision_executions" for each ROW execute function "decision_executions_trg_decision_executions_guard_fn"();`);
  }

  async down() {
    this.addSql(`alter table "decision_revisions" drop constraint "decision_revisions_request_id_foreign";`);
    this.addSql(`alter table "decisions" drop constraint "decisions_request_id_foreign";`);
    this.addSql(`alter table "decisions" drop constraint "decisions_revision_id_foreign";`);
    this.addSql(`alter table "decision_executions" drop constraint "decision_executions_revision_id_foreign";`);
    this.addSql(`alter table "decision_executions" drop constraint "decision_executions_decision_id_foreign";`);

    this.addSql(`drop table if exists "decision_requests" cascade;`);
    this.addSql(`drop trigger if exists "trg_decision_revisions_immutable" on "decision_revisions";`);
    this.addSql(`drop function if exists "decision_revisions_trg_decision_revisions_immutable_fn"();`);
    this.addSql(`drop table if exists "decision_revisions" cascade;`);
    this.addSql(`drop trigger if exists "trg_decisions_immutable" on "decisions";`);
    this.addSql(`drop function if exists "decisions_trg_decisions_immutable_fn"();`);
    this.addSql(`drop table if exists "decisions" cascade;`);
    this.addSql(`drop trigger if exists "trg_decision_executions_guard" on "decision_executions";`);
    this.addSql(`drop function if exists "decision_executions_trg_decision_executions_guard_fn"();`);
    this.addSql(`drop table if exists "decision_executions" cascade;`);
  }

}
