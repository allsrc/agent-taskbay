"""
Approval request and response models for Agent Taskbay.
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional

APPROVAL_MEDIA_TYPE = "application/vnd.agent-taskbay.approval-request+json"


@dataclass
class ApprovalRequest:
    title: str
    risk_level: str  # "low", "medium", "high"
    action: Dict[str, Any]
    description: Optional[str] = None
    revision: int = 1

    def to_dict(self) -> Dict[str, Any]:
        data = {
            "title": self.title,
            "riskLevel": self.risk_level,
            "action": self.action,
            "revision": self.revision,
        }
        if self.description:
            data["description"] = self.description
        return data


class OperatorResponse:
    """Helper provided to task handlers to respond back to Taskbay."""
    def __init__(self, task_id: str):
        self.task_id = task_id

    def request_approval(
        self,
        title: str,
        risk_level: str = "high",
        action: Optional[Dict[str, Any]] = None,
        description: Optional[str] = None
    ) -> Dict[str, Any]:
        return {
            "type": "approval",
            "approval": ApprovalRequest(
                title=title,
                risk_level=risk_level,
                action=action or {},
                description=description
            )
        }

    def complete(self, message: str) -> Dict[str, Any]:
        return {
            "type": "complete",
            "message": message
        }
