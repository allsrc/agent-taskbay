#!/usr/bin/env python3
"""
Google Agent Development Kit (ADK) + Agent Taskbay Integration
Demonstrates how an ADK agent uses LongRunningFunctionTool or require_confirmation
to delegate human approval to Agent Taskbay, hibernating its RunState until approved.
"""

import sys
import time
import json
import uuid
from typing import Dict, Any, Optional

class TaskbayADKGateway:
    """
    Client gateway connecting Google ADK tool invocations to the
    Agent Taskbay Human Operations Console.
    """
    def __init__(self, console_url: str = "http://127.0.0.1:3002"):
        self.console_url = console_url.rstrip("/")

    def request_tool_approval(
        self,
        tool_name: str,
        action_title: str,
        risk_level: str,
        action_payload: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Registers an out-of-process approval gate in Agent Taskbay.
        In production, this publishes an A2A task with `auth-required`
        and the approval-request extension to the Taskbay database.
        """
        ticket_id = f"adk-ticket-{uuid.uuid4().hex[:8]}"
        print("\n" + "=" * 65)
        print(f"[Google ADK] LongRunningFunctionTool triggered: {tool_name}")
        print(f"  • Title: {action_title}")
        print(f"  • Risk Level: {risk_level.upper()}")
        print(f"  • Parameters: {json.dumps(action_payload, indent=2)}")
        print(f"  • Taskbay Console: {self.console_url}/inbox")
        print(f"  • Approval Ticket ID: {ticket_id}")
        print("=" * 65)
        print("[Google ADK] RunState snapshot saved to storage.")
        print("[Google ADK] Agent entered dormancy / hibernation (0% CPU/RAM allocated)...")

        # Simulate operator reviewing the action in the Taskbay console
        time.sleep(2.0)

        # Operator reviews exact revision in Taskbay console and approves
        decision = {
            "ticket_id": ticket_id,
            "decision": "approved",
            "decided_by": "lead-sre@local",
            "revision": 1,
            "comment": "Approved following change review ticket RFC-8812."
        }
        print(f"\n[Taskbay Console] Decision Delivered: {decision['decision'].upper()}")
        print(f"  • Decided by: {decision['decided_by']}")
        print(f"  • Revision Lock: rev {decision['revision']} verified")
        print(f"  • Comment: {decision['comment']}")
        print("[Google ADK] RunState restored from snapshot. Resuming execution loop...\n")

        return decision


def run_adk_demo():
    print("=" * 65)
    print("Google Agent Development Kit (ADK) + Agent Taskbay Integration")
    print("=" * 65)

    gateway = TaskbayADKGateway()

    # Step 1: Agent determines high-risk action
    action_title = "Scale Production Kubernetes Cluster"
    tool_name = "scale_nodepool_capacity"
    payload = {
        "cluster": "prod-us-central1-gke",
        "nodepool": "gpu-inference-pool",
        "target_nodes": 64,
        "estimated_cost_per_day": "$1,450.00"
    }

    try:
        # Check if official google-adk package is available
        import google.adk as adk # type: ignore

        print("[ADK Framework] Using installed google-adk library.")
        # When google-adk is present, developers register a LongRunningFunctionTool:
        # tool = adk.tools.LongRunningFunctionTool(
        #     name=tool_name,
        #     description="Scales cluster nodes with human approval",
        #     handler=lambda **kwargs: gateway.request_tool_approval(tool_name, action_title, "high", kwargs)
        # )

    except ImportError:
        print("[Notice] `google-adk` package not installed in current environment.")
        print("[Notice] Running architectural simulation of ADK LongRunningFunctionTool & RunState dormancy:\n")

    # Step 2: Trigger approval gate via Taskbay
    decision = gateway.request_tool_approval(
        tool_name=tool_name,
        action_title=action_title,
        risk_level="high",
        action_payload=payload
    )

    if decision.get("decision") == "approved":
        print(f"[Execution Engine] Tool `{tool_name}` successfully executed with approved parameters:")
        print(f"  --> GKE node pool '{payload['nodepool']}' scaled to {payload['target_nodes']} nodes.")
        print("[Google ADK] Workflow completed with 100% auditable provenance.")
    else:
        print("[Execution Engine] Action aborted: Operator rejected request.")


if __name__ == "__main__":
    run_adk_demo()
