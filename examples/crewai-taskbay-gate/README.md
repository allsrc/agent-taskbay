# CrewAI sketch

This directory is an illustrative sketch of a tool wrapper. It does not contact Agent Taskbay. There is no CrewAI adapter in this repository.

```bash
python crewai_gate.py
```

`crewai` is optional. Without it, the same step runs in plain Python. The script prints the action it would have wanted a person to review, then stops. It does not approve that action and it does not run the command in the details string.

The requirements file lists CrewAI for the optional import. The script never uses HTTP.
