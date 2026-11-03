# Experimental Python agent helper

An experimental helper for serving a small A2A agent that can ask Agent Taskbay to approve one action. It is not a client of the Taskbay HTTP API, and it is not the client SDK tracked in [#31](https://github.com/allsrc/agent-taskbay/issues/31). It is not published on PyPI. `pip install agent-taskbay` does not install this package.

The helper speaks JSON-RPC, advertises `https://extensions.allsrc.dev/agent-taskbay/approval-request/v1`, and puts the approval in an `INPUT_REQUIRED` data part. Those extensions are defined by this project. They are not A2A standards.

## Install

From a checkout of this repository:

```bash
pip install -e sdk/python
```

From git, without a checkout of the rest of the repo:

```bash
pip install "git+https://github.com/allsrc/agent-taskbay.git#subdirectory=sdk/python"
```

Python 3.10 or newer. The helper uses only the standard library.

## Ask for an approval

```python
from agent_taskbay import AgentCard, AgentServer, Skill

card = AgentCard(
    name="Python DevOps Agent",
    description="Asks before it deploys.",
    skills=[Skill(id="deploy-prod", name="Deploy", description="Proposes a deploy.")],
)
server = AgentServer(card, host="127.0.0.1", port=5050)

@server.on_task
def handle(task_id, message, operator):
    if "deploy" in message.lower():
        return operator.request_approval(
            "Deploy auth-service v2.4.0",
            "Approved. Deploy auth-service v2.4.0.",
            summary="Roll the service out to production.",
            risk="high",
        )
    return operator.complete("Nothing to approve.")

if __name__ == "__main__":
    server.start()
```

The process prints `AGENT_CARD_URL=http://127.0.0.1:5050/.well-known/agent-card.json`. `http://127.0.0.1:5050/card.json` is the same card. In the console, add the agent with either URL.

Start the console with `npx agent-taskbay` (loopback, local administrator). Open the agent, start a chat, and send a message that asks for approval. **Inbox** shows the pending decision. Approving sends the `text` you passed, once, with `metadata.approval`. Rejecting sends nothing.

## What a follow-up means

| What arrives | What the helper does |
| --- | --- |
| `metadata.approval` with `revision` and a `revisionDigest` that matches the text (or data) in that message | Completes the task and echoes the digest |
| Anything else, including a chat reply or the word "rejected" | Leaves the task in `TASK_STATE_INPUT_REQUIRED` and does not run the action |
| A rejection in the console | No message. The task keeps waiting |

The digest is SHA-256 of the canonical JSON of the action, with object keys sorted. It is the same value the console stores. It is not a signature. A reviewer who edits the action sends the edited content and that revision's digest; the helper accepts it when the digest matches what arrived.

## Limits

- Experimental. The module layout and arguments can change in any commit. The console's own compatibility promise does not cover this package.
- One in-memory process. Tasks disappear when the process stops. There is no streaming, push, or `CancelTask`.
- It does not call the console. Taskbay connects to the agent, the same way it connects to any other A2A agent.
- It does not plug into LangGraph, CrewAI, AutoGen, or Google ADK. Those bridges are not in this repository. The ADK one is [#18](https://github.com/allsrc/agent-taskbay/issues/18).

`examples/python-requests-taskbay` is a short agent built with this helper. The other directories under `examples/` are sketches and do not open a connection.

## Tests

```bash
pip install -e sdk/python
python -m unittest discover -s sdk/python/tests -v
```
