"""
Agent Card models according to A2A specification.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional

APPROVAL_EXTENSION_URI = "https://extensions.allsrc.dev/agent-taskbay/approval-request/v1"
FORM_EXTENSION_URI = "https://extensions.allsrc.dev/agent-taskbay/structured-form/v1"


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
    version: str = "1.0.0"
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
                "extensions": self.extensions,
            },
            "defaultInputModes": ["text/plain"],
            "defaultOutputModes": ["text/plain"],
            "skills": [s.to_dict() for s in self.skills],
        }
