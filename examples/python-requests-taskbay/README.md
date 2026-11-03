# Plain Python agent

A small A2A agent built with the experimental helper in [`sdk/python`](../../sdk/python). It asks Agent Taskbay to approve one database migration. The helper is not on PyPI.

## Run it

```bash
pip install -e ../../sdk/python
python agent.py
```

The process prints `AGENT_CARD_URL=http://127.0.0.1:5050/.well-known/agent-card.json`. `http://127.0.0.1:5050/card.json` serves the same card.

In another terminal:

```bash
npx agent-taskbay
```

In the console, open **Agents**, choose **Add agent**, and paste the card URL. Fetch the card, then connect. Open the agent, choose **Start chat**, and send `migrate the audit log index`.

**Inbox** should show a pending approval titled "Production database schema migration", risk high. The proposed action is the index statement in `agent.py`.

- **Approve** sends that statement back once. The task completes, and the agent's reply includes the revision digest.
- **Reject** sends nothing. The task stays `input-required`.
- A chat reply that is not the approved message does not run the migration. The task stays `input-required`.

`TASK_STATE_AUTH_REQUIRED` is not used here. That state means the agent needs credentials. An approval is `TASK_STATE_INPUT_REQUIRED` plus the approval-request data part.

Pass a port as the first argument (`python agent.py 5051`) when 5050 is taken.
