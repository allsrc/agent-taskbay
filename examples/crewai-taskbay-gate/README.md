# Adding an Approval Gate to CrewAI Workflows with Agent Taskbay

This example demonstrates how to integrate **Agent Taskbay** as an approval gate within a [CrewAI](https://github.com/crewAIInc/crewAI) multi-agent workflow.

## Overview

When building autonomous multi-agent teams with CrewAI (e.g., a Senior DevOps Engineer agent, a QA agent, and a Deployment agent), certain tasks must not be executed automatically:
- Modifying production DNS records
- Executing infrastructure tear-downs
- Transferring funds or issuing customer refunds

Using Agent Taskbay, the CrewAI tool emits a durable approval request to Taskbay. The team waits until the operator in the Taskbay console reviews the exact proposed action and approves it.

## Running the Example

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start Taskbay in another terminal (if not running)
npx agent-taskbay

# 3. Run the CrewAI workflow
python crewai_gate.py
```

## Architecture

```text
[CrewAI Agent] 
       │ (1) Proposes sensitive action
       ▼
[Taskbay Approval Tool]
       │ (2) Emits auth-required task to Taskbay
       ▼
[Taskbay Operations Console (http://127.0.0.1:3002)]
       │ (3) Operator reviews diff / parameters and approves
       ▼
[Taskbay Approval Tool]
       │ (4) Receives signed decision with revision lock
       ▼
[Execution Environment]
       (5) Proceeds with execution
```
