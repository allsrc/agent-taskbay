#!/usr/bin/env python3
"""Plain-Python agent that asks Agent Taskbay to approve one action.

Run it, then connect ``/.well-known/agent-card.json`` (or ``/card.json``) in the
console. The first message on a task opens an approval. A later message completes
the task only when it carries ``metadata.approval`` whose digest matches the
approved text. A chat reply leaves the task waiting. Rejecting in the console
sends no message.
"""

import sys

try:
    from agent_taskbay import AgentCard, AgentServer, Skill
except ImportError:
    sys.stderr.write(
        "This example needs the experimental helper, which is not on PyPI.\n"
        "From a checkout of this repository:\n"
        "  pip install -e ../../sdk/python\n"
    )
    raise SystemExit(1)


APPROVED_TEXT = "Apply migration: CREATE INDEX CONCURRENTLY idx_audit_created ON audit_logs(created_at);"


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5050
    card = AgentCard(
        name="Python Ops Agent",
        description="Asks a person to approve a database migration before doing anything else.",
        skills=[
            Skill(
                id="migrate-database",
                name="Database migration",
                description="Proposes a schema migration and waits for an approval.",
                tags=["ops", "database"],
                examples=["migrate the audit log index"],
            )
        ],
    )
    server = AgentServer(card, host="127.0.0.1", port=port)

    @server.on_task
    def handle(_task_id: str, message: str, operator):
        asked = message or "(empty)"
        return operator.request_approval(
            "Production database schema migration",
            APPROVED_TEXT,
            summary=f"Operator said: {asked}. Create an index on audit_logs(created_at). Nothing runs until this exact text is approved.",
            risk="high",
            expires_in_seconds=3600,
        )

    server.start()


if __name__ == "__main__":
    main()
