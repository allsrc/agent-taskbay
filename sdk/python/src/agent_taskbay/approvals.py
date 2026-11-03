"""Approval requests in the shape Agent Taskbay opens, and how a reply is judged.

The console opens a decision only for a data part whose media type is
``application/vnd.agent-taskbay.approval-request+json``, on a task in
``TASK_STATE_INPUT_REQUIRED``. Field names and the action shape are the ones in
``docs/reference/extensions/approval-request.md``.

On approval the console sends the approved content back on the same task.
``metadata.approval`` carries ``requestId``, ``decisionId``, ``revision`` and
``revisionDigest``. The digest is the SHA-256 of the canonical JSON of the
action. A rejection sends nothing. A follow-up without a matching digest is
not an approval.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Any, Dict, Optional

APPROVAL_MEDIA_TYPE = "application/vnd.agent-taskbay.approval-request+json"
RISKS = ("low", "medium", "high")


def canonical_json(value: Any) -> str:
    """Match ``canonicalJson`` in ``src/server/application/services/event-identity.ts``."""
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + canonical_json(value[key]) for key in sorted(value)
        ) + "}"
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def action_digest(action: Dict[str, Any]) -> str:
    """SHA-256 hex of the action, with the same key set the console hashes."""
    if action.get("kind") == "send_data":
        payload: Dict[str, Any] = {"kind": "send_data", "form": action["form"], "values": action["values"]}
    else:
        payload = {"kind": "send_message", "text": action["text"], "data": action.get("data", None)}
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


@dataclass
class ApprovalRequest:
    title: str
    action: Dict[str, Any]
    summary: str = ""
    risk: str = "medium"
    expires_in_seconds: Optional[int] = None

    def validate(self) -> None:
        if not isinstance(self.title, str) or not self.title.strip() or len(self.title) > 300:
            raise ValueError("title must be 1 to 300 characters")
        if not isinstance(self.summary, str) or len(self.summary) > 4000:
            raise ValueError("summary must be at most 4000 characters")
        if self.risk not in RISKS:
            raise ValueError("risk must be low, medium or high")
        if self.expires_in_seconds is not None and (
            isinstance(self.expires_in_seconds, bool) or not isinstance(self.expires_in_seconds, int)
        ):
            raise ValueError("expires_in_seconds must be an integer number of seconds")
        action = self.action
        if not isinstance(action, dict):
            raise ValueError("action must be an object")
        if action.get("kind") == "send_message":
            text = action.get("text")
            if not isinstance(text, str) or not text.strip() or len(text) > 20_000:
                raise ValueError("send_message text must be 1 to 20000 characters")
            data = action.get("data", None)
            if data is not None and not isinstance(data, dict):
                raise ValueError("send_message data must be an object")
            return
        if action.get("kind") == "send_data":
            if not isinstance(action.get("form"), dict) or not isinstance(action.get("values"), dict):
                raise ValueError("send_data needs a form object and a values object")
            return
        raise ValueError("action.kind must be send_message or send_data")

    def to_dict(self) -> Dict[str, Any]:
        self.validate()
        body: Dict[str, Any] = {
            "title": self.title.strip(),
            "summary": self.summary,
            "risk": self.risk,
            "action": self.action,
        }
        if self.expires_in_seconds is not None:
            body["expiresInSeconds"] = self.expires_in_seconds
        return body

    def to_part(self) -> Dict[str, Any]:
        """A data part. A text part with this media type does not open a decision."""
        return {"data": self.to_dict(), "mediaType": APPROVAL_MEDIA_TYPE}


class OperatorResponse:
    """What a task handler returns to the server."""

    def __init__(self, task_id: str):
        self.task_id = task_id

    def request_approval(
        self,
        title: str,
        text: str,
        *,
        summary: str = "",
        risk: str = "medium",
        data: Optional[Dict[str, Any]] = None,
        expires_in_seconds: Optional[int] = None,
    ) -> Dict[str, Any]:
        action: Dict[str, Any] = {"kind": "send_message", "text": text}
        if data is not None:
            action["data"] = data
        return {
            "type": "approval",
            "approval": ApprovalRequest(
                title=title,
                summary=summary,
                risk=risk,
                action=action,
                expires_in_seconds=expires_in_seconds,
            ),
        }

    def complete(self, message: str) -> Dict[str, Any]:
        return {"type": "complete", "message": message}


def received_action(message: Dict[str, Any], pending: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """The action implied by a follow-up, or None when the parts are not that action."""
    parts = message.get("parts")
    if not isinstance(parts, list):
        return None
    metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
    if pending.get("kind") == "send_data":
        data_parts = [part for part in parts if isinstance(part, dict) and "data" in part and "text" not in part]
        if len(data_parts) != 1 or not isinstance(data_parts[0].get("data"), dict):
            return None
        return {"kind": "send_data", "form": pending.get("form"), "values": data_parts[0]["data"]}
    text_parts = [part for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str)]
    if len(text_parts) != 1 or not text_parts[0]["text"]:
        return None
    decision = metadata.get("decision", None)
    if decision is not None and not isinstance(decision, dict):
        return None
    return {"kind": "send_message", "text": text_parts[0]["text"], "data": decision}


def interpret_follow_up(message: Dict[str, Any], pending_action: Dict[str, Any]) -> Dict[str, Any]:
    """Approve only when ``metadata.approval`` matches the content that arrived.

    A rejection does not arrive as a message. A chat reply, a missing digest,
    or a digest that does not match the received action is ``not_approved``.
    """
    metadata = message.get("metadata") if isinstance(message.get("metadata"), dict) else {}
    approval = metadata.get("approval")
    if not isinstance(approval, dict):
        return {"outcome": "not_approved", "reason": "no_approval"}
    revision = approval.get("revision")
    digest = approval.get("revisionDigest")
    if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
        return {"outcome": "not_approved", "reason": "bad_revision"}
    if not isinstance(digest, str) or len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest.lower()):
        return {"outcome": "not_approved", "reason": "bad_digest"}
    if not isinstance(approval.get("requestId"), str) or not approval["requestId"]:
        return {"outcome": "not_approved", "reason": "bad_approval"}
    if not isinstance(approval.get("decisionId"), str) or not approval["decisionId"]:
        return {"outcome": "not_approved", "reason": "bad_approval"}
    received = received_action(message, pending_action)
    if received is None:
        return {"outcome": "not_approved", "reason": "unreadable"}
    actual = action_digest(received)
    if actual != digest.lower():
        return {"outcome": "not_approved", "reason": "digest_mismatch"}
    return {
        "outcome": "approved",
        "revision": revision,
        "revisionDigest": actual,
        "requestId": approval["requestId"],
        "decisionId": approval["decisionId"],
        "action": received,
    }
