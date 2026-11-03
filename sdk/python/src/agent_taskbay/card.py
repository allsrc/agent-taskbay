"""Agent Card models for the subset this helper serves.

Extension entries are objects with ``uri`` and ``required``, which is what A2A 1.0
and Agent Taskbay read. A list of bare URI strings does not advertise the extension.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List

APPROVAL_EXTENSION_URI = "https://extensions.allsrc.dev/agent-taskbay/approval-request/v1"
FORM_EXTENSION_URI = "https://extensions.allsrc.dev/agent-taskbay/structured-form/v1"


def extension_entry(uri: str, *, required: bool = False) -> Dict[str, Any]:
    return {"uri": uri, "required": required}


@dataclass
class Skill:
    id: str
    name: str
    description: str
    tags: List[str] = field(default_factory=list)
    examples: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "tags": self.tags,
            "examples": self.examples,
        }


@dataclass
class AgentCard:
    name: str
    description: str
    version: str = "0.1.0"
    skills: List[Skill] = field(default_factory=list)
    extensions: List[str] = field(default_factory=lambda: [APPROVAL_EXTENSION_URI])
    streaming: bool = False
    push_notifications: bool = False

    def to_dict(self, base_url: str) -> Dict[str, Any]:
        return {
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "supportedInterfaces": [
                {
                    "url": f"{base_url.rstrip('/')}/a2a",
                    "protocolBinding": "JSONRPC",
                    "protocolVersion": "1.0",
                }
            ],
            "capabilities": {
                "streaming": self.streaming,
                "pushNotifications": self.push_notifications,
                "extensions": [extension_entry(uri) for uri in self.extensions],
            },
            "defaultInputModes": ["text/plain", "application/json"],
            "defaultOutputModes": ["text/plain", "application/json"],
            "skills": [skill.to_dict() for skill in self.skills],
        }
