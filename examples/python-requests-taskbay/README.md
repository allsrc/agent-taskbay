# Python A2A Agent for Agent Taskbay

This example shows how to write a minimal, dependency-free Python agent that exposes an A2A Agent Card over HTTP and communicates with **Agent Taskbay**.

No external frameworks or heavyweight dependencies are required—it uses Python's built-in `http.server` library.

## What This Agent Does

1. **Publishes an Agent Card** at `http://127.0.0.1:5050/card.json` advertising the `approval-request` extension.
2. **Accepts tasks** sent from the Taskbay console.
3. **Simulates a sensitive task** (e.g. "Migrate production database").
4. **Requests human sign-off** by returning `status: "auth-required"` with an approval object.
5. **Completes the task** once the human operator approves the request in Taskbay.

## Running the Agent

```bash
# 1. Start this Python agent
python agent.py

# 2. Start Taskbay in another terminal (if not running)
npx agent-taskbay

# 3. Connect the agent in the Taskbay console:
#    - Open http://127.0.0.1:3002
#    - Go to Agents -> Add Agent
#    - Enter URL: http://127.0.0.1:5050/card.json
#    - Click Fetch Agent Card -> Connect
```

## Testing Human Approval

1. In Taskbay, open your newly connected **Python Ops Agent**.
2. Click **Start chat** and type: `run database migration`.
3. Switch to the **Inbox** tab in Taskbay. You will see an approval request marked **High risk** titled `"Migrate production database"`.
4. Click **Approve**.
5. The agent receives the approved decision and completes the task!
