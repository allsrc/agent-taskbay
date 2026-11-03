"""Illustrative sketch of a CrewAI tool that might later ask for approval.

This file does not open a socket and does not talk to Agent Taskbay.
There is no CrewAI bridge in this repository.
"""


def describe_paused_action(action_title: str, risk_level: str, action_details: str) -> bool:
    print("Sketch only: no Agent Taskbay request was sent, and nothing was approved.")
    print(f"  Action: {action_title}")
    print(f"  Risk label in this sketch: {risk_level}")
    print(f"  Details: {action_details}")
    return False


def run() -> None:
    print("CrewAI sketch. This process does not contact Agent Taskbay.")
    title = "Terminate staging database cluster"
    details = "aws rds delete-db-instance --db-instance-identifier staging-postgres-db"
    try:
        from typing import Type

        from crewai.tools import BaseTool
        from pydantic import BaseModel, Field

        class ApprovalInput(BaseModel):
            action_title: str = Field(..., description="Short title of the sensitive operation")
            risk_level: str = Field("high", description="low, medium, or high")
            action_details: str = Field(..., description="What the tool would do if a person had approved it")

        class SketchTool(BaseTool):
            name: str = "describe_unsent_approval"
            description: str = "Prints an action this sketch does not send to Agent Taskbay."
            args_schema: Type[BaseModel] = ApprovalInput

            def _run(self, action_title: str, risk_level: str, action_details: str) -> str:
                describe_paused_action(action_title, risk_level, action_details)
                return f"Not sent and not approved: {action_title}"

        print(SketchTool()._run(action_title=title, risk_level="high", action_details=details))
    except ImportError:
        print("crewai is not installed. Running the same step in plain Python.")
        describe_paused_action(title, "high", details)
        print("Not sent and not approved.")


if __name__ == "__main__":
    run()
