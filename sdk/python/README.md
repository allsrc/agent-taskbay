# agent-taskbay (Python SDK)

Official lightweight Python SDK for **Agent Taskbay** — the open-source human-in-the-loop (HITL) operations console for AI agents and A2A workflows.

## Installation

```bash
pip install agent-taskbay
```

## Quick Start: Host an A2A Agent in 5 Lines

```python
from agent_taskbay import AgentServer, AgentCard, Skill

# 1. Define skills
deploy_skill = Skill(
    id="deploy-prod",
    name="Deploy Production",
    description="Rolls out services to production clusters with human sign-off."
)

# 2. Configure Agent Card
card = AgentCard(
    name="Python DevOps Agent",
    description="Automates infrastructure operations.",
    skills=[deploy_skill]
)

# 3. Create server and start
server = AgentServer(card=card, host="127.0.0.1", port=5050)

@server.on_task
def handle_task(task_id: str, message: str, operator):
    if "deploy" in message.lower():
        # Request human approval in Taskbay console
        return operator.request_approval(
            title="Deploy auth-service v2.4.0",
            risk_level="high",
            action={"service": "auth-service", "version": "v2.4.0"}
        )
    return operator.complete("Task finished successfully.")

if __name__ == "__main__":
    server.start()
```

Connect your agent to Taskbay by pasting `http://127.0.0.1:5050/card.json` into the Taskbay UI at `http://127.0.0.1:3002`.

## Features

- **Zero Heavy Dependencies**: Pure Python, zero mandatory third-party requirements.
- **A2A Protocol Native**: Automatic Agent Card discovery (`/.well-known/agent.json` or `/card.json`) and JSON-RPC 2.0 communication.
- **Approval Gate Support**: Native support for the `https://extensions.allsrc.dev/agent-taskbay/approval-request/v1` extension.
- **Framework Agnostic**: Plugs directly into LangGraph, CrewAI, AutoGen, or custom Python agent loops.

## Documentation

- Web Console: [https://taskbay.allsrc.dev](https://taskbay.allsrc.dev)
- GitHub: [https://github.com/allsrc/agent-taskbay](https://github.com/allsrc/agent-taskbay)
- License: MIT
