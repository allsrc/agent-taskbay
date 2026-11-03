# LangGraph sketch

This directory is an illustrative sketch of a graph that pauses before a destructive statement. It does not contact Agent Taskbay, and it does not call LangGraph's `interrupt()`.

LangGraph can already pause a graph with `interrupt()` and a checkpointer, including Postgres. That durability is LangGraph's. Taskbay is a separate console for A2A agents. A bridge between the two is not in this repository.

```bash
python adapter.py
```

`langgraph` is optional. Without it, the same steps run in plain Python. Either way the script prints that nothing was sent and nothing was approved, then stops before executing the statement.

The requirements file lists LangGraph for the optional import. It does not install Taskbay, and the script never uses HTTP.
