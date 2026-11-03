# LangGraph Human-in-the-Loop Interrupt with Agent Taskbay

This example demonstrates how to integrate **Agent Taskbay** as an out-of-process, durable human approval gate for [LangGraph](https://github.com/langchain-ai/langgraph) workflows.

## The Problem

In standard LangGraph applications, `interrupt()` or human-in-the-loop nodes pause execution. However:
- Keeping long-running Python processes in memory while waiting hours or days for human review is fragile and costly.
- If the server restarts or worker times out, in-memory state can be lost.
- A human operator needs a clean, dedicated operations console (with role-based access, audit trails, and multi-modal previews) rather than terminal prompts or ad-hoc Slack messages.

## The Solution: Taskbay Durable Gates

By routing high-risk actions to an A2A agent or Taskbay task:
1. The LangGraph agent submits a durable task to Taskbay with an approval request (`auth-required`).
2. The agent state is persisted durably in Taskbay's embedded PGlite/Postgres database.
3. The operator reviews the proposed action, verifies the exact parameters, and clicks **Approve** in the Taskbay console.
4. The approved revision is delivered back, and the LangGraph workflow resumes.

## Running the Example

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start Taskbay in another terminal (if not already running)
npx agent-taskbay

# 3. Run the LangGraph script
python adapter.py
```

## How It Works

See `adapter.py` for the complete workflow implementation.
