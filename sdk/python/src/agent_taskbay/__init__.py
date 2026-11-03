"""Experimental helper for writing an A2A agent that asks Agent Taskbay for approval.

This is not a client of the Taskbay HTTP API, and it is not the client SDK
tracked in https://github.com/allsrc/agent-taskbay/issues/31.
"""

from .approvals import ApprovalRequest, OperatorResponse, action_digest, interpret_follow_up
from .card import APPROVAL_EXTENSION_URI, FORM_EXTENSION_URI, AgentCard, Skill
from .server import AgentServer

__version__ = "0.1.0"
__all__ = [
    "APPROVAL_EXTENSION_URI",
    "FORM_EXTENSION_URI",
    "AgentCard",
    "AgentServer",
    "ApprovalRequest",
    "OperatorResponse",
    "Skill",
    "action_digest",
    "interpret_follow_up",
]
