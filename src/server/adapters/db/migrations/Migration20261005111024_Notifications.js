import { Migration } from "@mikro-orm/migrations";

export class Migration20261005111024_Notifications extends Migration {

  name = 'Migration20261005111024_Notifications';

  async up() {
    this.addSql(`create table "notifications" ("id" uuid not null, "organization_id" uuid not null, "kind" varchar(48) not null, "task_id" uuid null, "subject_id" uuid null, "actor_user_id" uuid null, "title" varchar(200) not null, "body" text not null, "link" varchar(300) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_notifications_org_created" on "notifications" ("organization_id", "created_at");`);

    this.addSql(`create table "notification_recipients" ("id" uuid not null, "notification_id" uuid not null, "organization_id" uuid not null, "membership_id" uuid not null, "read_at" timestamptz null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "idx_notification_recipients_inbox" on "notification_recipients" ("membership_id", "created_at");`);
    this.addSql(`create index "idx_notification_recipients_unread" on "notification_recipients" ("membership_id", "read_at");`);
    this.addSql(`alter table "notification_recipients" add constraint "uq_notification_recipient" unique ("notification_id", "membership_id");`);

    this.addSql(`alter table "decision_requests" add "expiry_warned_at" timestamptz null;`);

    this.addSql(`alter table "notifications" add constraint "notifications_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "notifications" add constraint "notifications_task_id_foreign" foreign key ("task_id") references "tasks" ("id") on delete set null;`);
    this.addSql(`alter table "notifications" add constraint "notifications_actor_user_id_foreign" foreign key ("actor_user_id") references "users" ("id") on delete no action;`);
    this.addSql(`create or replace function "notifications_trg_notifications_immutable_fn"() returns trigger as \$\$ begin raise exception 'notifications are immutable' using errcode = '23000'; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_notifications_immutable" BEFORE UPDATE OR DELETE on "notifications" for each ROW execute function "notifications_trg_notifications_immutable_fn"();`);

    this.addSql(`alter table "notification_recipients" add constraint "notification_recipients_notification_id_foreign" foreign key ("notification_id") references "notifications" ("id");`);
    this.addSql(`alter table "notification_recipients" add constraint "notification_recipients_organization_id_foreign" foreign key ("organization_id") references "organizations" ("id");`);
    this.addSql(`alter table "notification_recipients" add constraint "notification_recipients_membership_id_foreign" foreign key ("membership_id") references "memberships" ("id");`);
    this.addSql(`create or replace function "notification_recipients_trg_nr_read_mark_only_fn"() returns trigger as \$\$ begin if tg_op = 'DELETE' or new.id <> old.id or new.notification_id <> old.notification_id or new.organization_id <> old.organization_id or new.membership_id <> old.membership_id or new.created_at <> old.created_at then raise exception 'notification recipients are immutable except the read mark' using errcode = '23000'; end if; return new; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_nr_read_mark_only" BEFORE UPDATE OR DELETE on "notification_recipients" for each ROW execute function "notification_recipients_trg_nr_read_mark_only_fn"();`);
  }

  async down() {
    this.addSql(`alter table "notification_recipients" drop constraint "notification_recipients_notification_id_foreign";`);

    this.addSql(`drop trigger if exists "trg_notifications_immutable" on "notifications";`);
    this.addSql(`drop function if exists "notifications_trg_notifications_immutable_fn"();`);
    this.addSql(`drop table if exists "notifications" cascade;`);
    this.addSql(`drop trigger if exists "trg_nr_read_mark_only" on "notification_recipients";`);
    this.addSql(`drop function if exists "notification_recipients_trg_nr_read_mark_only_fn"();`);
    this.addSql(`drop table if exists "notification_recipients" cascade;`);

    this.addSql(`alter table "decision_requests" drop column "expiry_warned_at";`);
  }

}
