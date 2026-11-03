# Google ADK sketch

This directory is an illustrative sketch. It does not contact Agent Taskbay, and it does not call ADK.

ADK can pause a tool with `FunctionTool(require_confirmation=True)` or `tool_context.request_confirmation` (experimental in ADK, and not supported with `DatabaseSessionService` or `VertexAiSessionService`). ADK workflows can pause with `RequestInput`. Those pauses are ADK's. This repository does not read them. That adapter is [issue #18](https://github.com/allsrc/agent-taskbay/issues/18).

```bash
python adk_agent.py
```

The script prints a cluster change it did not request approval for, then stops. No approval is created and no cluster is changed. `google-adk` is optional and is not required to run the sketch.
