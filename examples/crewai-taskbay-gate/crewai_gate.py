"""
CrewAI Taskbay Approval Gate Example
Demonstrates how to add an approval gate to a CrewAI agent workflow.
"""

import sys
import time
from typing import Type

class TaskbayApprovalGate:
    """
    Simulates / coordinates the Taskbay durable human-in-the-loop approval gate.
    """
    @staticmethod
    def request_approval(action_title: str, risk_level: str, action_details: str) -> bool:
        print("\n" + "=" * 50)
        print("[Taskbay Approval Gate] PAUSING CREWAI WORKFLOW")
        print(f"  • Action: {action_title}")
        print(f"  • Risk: {risk_level.upper()}")
        print(f"  • Details: {action_details}")
        print("  • Console: http://127.0.0.1:3002/inbox")
        print("=" * 50)
        print("[Taskbay Console] Waiting for human operator sign-off...")
        
        # In live deployments, this polls or listens for an A2A webhook callback
        time.sleep(1.5)
        
        print("[Taskbay Console] Operator 'ops-lead@local' APPROVED the request.")
        print("[Taskbay Console] Verified revision lock: rev 1. Resuming CrewAI workflow...\n")
        return True


def run_crewai_flow():
    try:
        from crewai.tools import BaseTool
        from pydantic import BaseModel, Field

        class ApprovalInput(BaseModel):
            action_title: str = Field(..., description="Short title of the sensitive operation")
            risk_level: str = Field("high", description="Risk level: low, medium, or high")
            action_details: str = Field(..., description="Detailed payload, SQL query, or command to execute")

        class TaskbayApprovalTool(BaseTool):
            name: str = "request_taskbay_human_approval"
            description: str = "Useful to submit high-risk operations to the Taskbay Human Operations Console for operator review before execution."
            args_schema: Type[BaseModel] = ApprovalInput

            def _run(self, action_title: str, risk_level: str, action_details: str) -> str:
                approved = TaskbayApprovalGate.request_approval(action_title, risk_level, action_details)
                if approved:
                    return f"SUCCESS: Operator approved action '{action_title}'. Proceed with execution."
                return f"ABORTED: Operator rejected action '{action_title}'."

        print("[CrewAI] TaskbayApprovalTool initialized successfully.")
        tool = TaskbayApprovalTool()
        result = tool._run(
            action_title="Terminate Staging Database Cluster",
            risk_level="high",
            action_details="aws rds delete-db-instance --db-instance-identifier staging-postgres-db"
        )
        print(f"[CrewAI Tool Output] {result}")

    except ImportError:
        print("[Notice] crewai is not installed in the local Python environment.")
        print("[Notice] Running standalone demonstration of the Taskbay Approval Tool...\n")
        approved = TaskbayApprovalGate.request_approval(
            action_title="Terminate Staging Database Cluster",
            risk_level="high",
            action_details="aws rds delete-db-instance --db-instance-identifier staging-postgres-db"
        )
        if approved:
            print("[Execution Step] Successfully executed: aws rds delete-db-instance --db-instance-identifier staging-postgres-db")


if __name__ == "__main__":
    run_crewai_flow()
