import { Migration } from "@mikro-orm/migrations";

export class Migration20261005081948_WorkflowOwnership extends Migration {

  name = 'Migration20261005081948_WorkflowOwnership';

  async up() {
    this.addSql(`create table "task_assignments" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "assignee_membership_id" uuid null, "claimed_at" timestamptz null, "due_at" timestamptz null, "escalation_level" int not null default 0, "escalated_at" timestamptz null, "updated_at" timestamptz not null, "version" int not null default 1, primary key ("id"));`);
    this.addSql(`create index "idx_task_assignments_assignee" on "task_assignments" ("organization_id", "assignee_membership_id");`);
    this.addSql(`create index "idx_task_assignments_due" on "task_assignments" ("due_at");`);
    this.addSql(`alter table "task_assignments" add constraint "uq_task_assignments_task" unique ("task_id");`);

    this.addSql(`create table "task_notes" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "note_key" varchar(255) not null, "author_user_id" uuid not null, "body" text not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_task_notes_task" on "task_notes" ("task_id", "created_at");`);
    this.addSql(`alter table "task_notes" add constraint "uq_task_notes_org_key" unique ("organization_id", "note_key");`);

    this.addSql(`create table "task_assignment_events" ("id" uuid not null, "organization_id" uuid not null, "task_id" uuid not null, "kind" varchar(32) not null, "actor_user_id" uuid null, "from_membership_id" uuid null, "to_membership_id" uuid null, "due_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_task_assignment_events_task" on "task_assignment_events" ("task_id", "created_at");`);

    this.addSql(`create table "escalation_policies" ("id" uuid not null, "organization_id" uuid not null, "agent_id" uuid null, "target_membership_id" uuid not null, "enabled" boolean not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_escalation_policies_scope" on "escalation_policies" ("organization_id", "agent_id");`);

    this.addSql(`alter table "task_assignments" add constraint "task_assignments_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "task_assignments" add constraint "task_assignments_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);

    this.addSql(`alter table "task_notes" add constraint "task_notes_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "task_notes" add constraint "task_notes_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);
    this.addSql(`alter table "task_notes" add constraint "task_notes_author_user_id_foreign" foreign key ("author_user_id") references "users" ("id") on delete no action;`);
    this.addSql(`create or replace function "task_notes_trg_task_notes_immutable_fn"() returns trigger as \$\$ begin raise exception 'workflow history is immutable' using errcode = '23000'; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_task_notes_immutable" BEFORE UPDATE OR DELETE on "task_notes" for each ROW execute function "task_notes_trg_task_notes_immutable_fn"();`);

    this.addSql(`alter table "task_assignment_events" add constraint "task_assignment_events_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "task_assignment_events" add constraint "task_assignment_events_task_id_foreign" foreign key ("task_id") references "tasks" ("id");`);
    this.addSql(`alter table "task_assignment_events" add constraint "task_assignment_events_actor_user_id_foreign" foreign key ("actor_user_id") references "users" ("id") on delete no action;`);
    this.addSql(`create or replace function "task_assignment_events_trg_task_assignment_events_immutable_fn"() returns trigger as \$\$ begin raise exception 'workflow history is immutable' using errcode = '23000'; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_task_assignment_events_immutable" BEFORE UPDATE OR DELETE on "task_assignment_events" for each ROW execute function "task_assignment_events_trg_task_assignment_events_immutable_fn"();`);

    this.addSql(`alter table "escalation_policies" add constraint "escalation_policies_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "escalation_policies" add constraint "escalation_policies_agent_id_foreign" foreign key ("agent_id") references "agents" ("id") on delete set null;`);
    this.addSql(`alter table "escalation_policies" add constraint "escalation_policies_target_membership_id_foreign" foreign key ("target_membership_id") references "memberships" ("id");`);
  }

  async down() {
    this.addSql(`drop table if exists "task_assignments" cascade;`);
    this.addSql(`drop trigger if exists "trg_task_notes_immutable" on "task_notes";`);
    this.addSql(`drop function if exists "task_notes_trg_task_notes_immutable_fn"();`);
    this.addSql(`drop table if exists "task_notes" cascade;`);
    this.addSql(`drop trigger if exists "trg_task_assignment_events_immutable" on "task_assignment_events";`);
    this.addSql(`drop function if exists "task_assignment_events_trg_task_assignment_events_immutable_fn"();`);
    this.addSql(`drop table if exists "task_assignment_events" cascade;`);
    this.addSql(`drop table if exists "escalation_policies" cascade;`);
  }

}
