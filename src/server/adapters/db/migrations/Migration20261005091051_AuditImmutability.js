import { Migration } from "@mikro-orm/migrations";

export class Migration20261005091051_AuditImmutability extends Migration {

  name = 'Migration20261005091051_AuditImmutability';

  async up() {
    this.addSql(`create or replace function "decision_requests_trg_decision_requests_core_fixed_fn"() returns trigger as \$\$ begin if tg_op = 'DELETE' or new.id <> old.id or new.organization_id <> old.organization_id or new.task_id <> old.task_id or new.agent_id <> old.agent_id or new.tenant <> old.tenant or new.skill_id is distinct from old.skill_id or new.kind <> old.kind or new.request_key <> old.request_key or new.title <> old.title or new.summary <> old.summary or new.risk <> old.risk or new.policy_json::text <> old.policy_json::text or new.requester_user_id is distinct from old.requester_user_id or new.expires_at <> old.expires_at or new.created_at <> old.created_at then raise exception 'decision request core is immutable' using errcode = '23000'; end if; return new; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_decision_requests_core_fixed" BEFORE UPDATE OR DELETE on "decision_requests" for each ROW execute function "decision_requests_trg_decision_requests_core_fixed_fn"();`);

    this.addSql(`create or replace function "security_audit_events_trg_security_audit_append_only_fn"() returns trigger as \$\$ begin raise exception 'audit records are append-only' using errcode = '23000'; end; \$\$ language plpgsql;`);
    this.addSql(`create trigger "trg_security_audit_append_only" BEFORE UPDATE OR DELETE on "security_audit_events" for each ROW execute function "security_audit_events_trg_security_audit_append_only_fn"();`);
  }

  async down() {
    this.addSql(`drop trigger if exists "trg_decision_requests_core_fixed" on "decision_requests";`);
    this.addSql(`drop function if exists "decision_requests_trg_decision_requests_core_fixed_fn"();`);

    this.addSql(`drop trigger if exists "trg_security_audit_append_only" on "security_audit_events";`);
    this.addSql(`drop function if exists "security_audit_events_trg_security_audit_append_only_fn"();`);
  }

}
