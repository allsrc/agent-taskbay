"""Illustrative sketch of an ADK confirmation pause.

Google ADK can pause a tool with ``FunctionTool(require_confirmation=True)`` or
``tool_context.request_confirmation``, and ADK workflows can use ``RequestInput``.
This file calls none of those, and it does not talk to Agent Taskbay.
An adapter that reads ADK approval pauses is tracked as
https://github.com/allsrc/agent-taskbay/issues/18.
"""

import json


def describe_unsent_action(tool_name: str, action_title: str, payload: dict) -> dict:
    print("Sketch only: no Agent Taskbay request was sent, and nothing was approved.")
    print(f"  Tool name in this sketch: {tool_name}")
    print(f"  Title: {action_title}")
    print(f"  Payload: {json.dumps(payload)}")
    return {"decision": "not_requested"}


def main() -> None:
    print("Google ADK sketch. This process does not contact Agent Taskbay.")
    payload = {
        "cluster": "prod-us-central1-gke",
        "nodepool": "gpu-inference-pool",
        "target_nodes": 64,
    }
    try:
        import google.adk  # noqa: F401

        print("google.adk is installed. This sketch still does not register a tool or send a request.")
    except ImportError:
        print("google.adk is not installed. The sketch does not need it.")
    outcome = describe_unsent_action("scale_nodepool_capacity", "Scale production Kubernetes cluster", payload)
    print(f"Outcome: {outcome['decision']}. No cluster change was made.")


if __name__ == "__main__":
    main()
