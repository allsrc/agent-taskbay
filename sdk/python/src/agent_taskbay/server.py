"""Minimal JSON-RPC agent that can ask Agent Taskbay for an approval.

Discovery paths are ``/.well-known/agent-card.json`` and ``/card.json``. A URL that
ends in ``.json`` is fetched as-is; a base URL is resolved at
``/.well-known/agent-card.json``. ``/.well-known/agent.json`` is served as well so
an old link still resolves; Taskbay does not look there when given a base URL.
"""

from __future__ import annotations

import datetime
import json
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Callable, Dict, Optional

from .approvals import ApprovalRequest, OperatorResponse, interpret_follow_up
from .card import AgentCard

CARD_PATHS = ("/card.json", "/.well-known/agent-card.json", "/.well-known/agent.json")
Handler = Callable[[str, str, OperatorResponse], Dict[str, Any]]


def _now() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _text_of(message: Dict[str, Any]) -> str:
    parts = message.get("parts") if isinstance(message.get("parts"), list) else []
    return " ".join(part.get("text", "") for part in parts if isinstance(part, dict) and isinstance(part.get("text"), str)).strip()


class AgentServer:
    def __init__(self, card: AgentCard, host: str = "127.0.0.1", port: int = 5050):
        self.card = card
        self.host = host
        self.port = port
        self.tasks: Dict[str, Dict[str, Any]] = {}
        self._pending: Dict[str, Dict[str, Any]] = {}
        self._handler: Optional[Handler] = None

    def on_task(self, fn: Handler) -> Handler:
        self._handler = fn
        return fn

    def handle_rpc(self, rpc: Dict[str, Any]) -> Dict[str, Any]:
        rpc_id = rpc.get("id")
        method = rpc.get("method")
        params = rpc.get("params") if isinstance(rpc.get("params"), dict) else {}
        if method == "SendMessage":
            return self._send_message(rpc_id, params)
        if method == "GetTask":
            task = self.tasks.get(params.get("id"))
            if not task:
                return _error(rpc_id, -32001, "Task not found")
            return _ok(rpc_id, task)
        if method == "ListTasks":
            tasks = list(self.tasks.values())
            return _ok(rpc_id, {"tasks": tasks, "pageSize": 50, "totalSize": len(tasks)})
        return _error(rpc_id, -32601, f"Method not found: {method}")

    def _send_message(self, rpc_id: Any, params: Dict[str, Any]) -> Dict[str, Any]:
        message = params.get("message") if isinstance(params.get("message"), dict) else {}
        task_id = message.get("taskId")
        if isinstance(task_id, str) and task_id in self.tasks:
            task = self._resume(self.tasks[task_id], message)
            return _ok(rpc_id, {"task": task})

        new_id = task_id if isinstance(task_id, str) and task_id else f"task-{uuid.uuid4().hex[:8]}"
        context_id = message.get("contextId") if isinstance(message.get("contextId"), str) else str(uuid.uuid4())
        spoken = _text_of(message)
        operator = OperatorResponse(new_id)
        if self._handler:
            result = self._handler(new_id, spoken, operator)
        else:
            result = operator.complete(f"Acknowledged: {spoken}")
        task = self._open_task(new_id, context_id, message, result)
        self.tasks[new_id] = task
        return _ok(rpc_id, {"task": task})

    def _open_task(self, task_id: str, context_id: str, user_message: Dict[str, Any], result: Dict[str, Any]) -> Dict[str, Any]:
        if result.get("type") == "approval":
            approval = result["approval"]
            if not isinstance(approval, ApprovalRequest):
                raise TypeError("request_approval must return the helper's ApprovalRequest")
            action = approval.to_dict()["action"]
            self._pending[task_id] = action
            parts = [
                {"text": f"Approval requested: {approval.title}"},
                approval.to_part(),
            ]
            state = "TASK_STATE_INPUT_REQUIRED"
        else:
            self._pending.pop(task_id, None)
            parts = [{"text": str(result.get("message", "Task completed."))}]
            state = "TASK_STATE_COMPLETED"
        status_message = {
            "messageId": f"{task_id}-status",
            "role": "ROLE_AGENT",
            "taskId": task_id,
            "contextId": context_id,
            "parts": parts,
        }
        return {
            "id": task_id,
            "contextId": context_id,
            "status": {"state": state, "timestamp": _now(), "message": status_message},
            "history": [user_message, status_message],
            "artifacts": [],
        }

    def _resume(self, task: Dict[str, Any], message: Dict[str, Any]) -> Dict[str, Any]:
        # A repeat delivery of an already finished task must not run the action again.
        if task["status"]["state"] == "TASK_STATE_COMPLETED":
            return task
        task_id = task["id"]
        pending = self._pending.get(task_id)
        decision = interpret_follow_up(message, pending) if pending else {"outcome": "not_approved", "reason": "no_approval"}
        task["history"].append(message)
        if decision["outcome"] == "approved":
            self._pending.pop(task_id, None)
            text = decision["action"].get("text") or json.dumps(decision["action"].get("values"), sort_keys=True)
            done = {
                "messageId": f"{task_id}-done",
                "role": "ROLE_AGENT",
                "taskId": task_id,
                "contextId": task["contextId"],
                "parts": [{"text": f"Executed with approval {decision['revisionDigest']} ({text})"}],
            }
            task["history"].append(done)
            task["status"] = {"state": "TASK_STATE_COMPLETED", "timestamp": _now(), "message": done}
            return task
        note = {
            "messageId": f"{task_id}-hold-{len(task['history'])}",
            "role": "ROLE_AGENT",
            "taskId": task_id,
            "contextId": task["contextId"],
            "parts": [{"text": "This reply is not an approved revision, so the proposed action was not run."}],
        }
        task["history"].append(note)
        task["status"]["state"] = "TASK_STATE_INPUT_REQUIRED"
        task["status"]["timestamp"] = _now()
        return task

    def serve(self) -> HTTPServer:
        server_instance = self

        class RequestHandler(BaseHTTPRequestHandler):
            def log_message(self, format: str, *args: Any) -> None:
                return

            def do_GET(self) -> None:  # noqa: N802
                path = self.path.split("?", 1)[0]
                if path not in CARD_PATHS:
                    self.send_response(404)
                    self.end_headers()
                    return
                body = json.dumps(server_instance.card.to_dict(server_instance.base_url), indent=2).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self) -> None:  # noqa: N802
                if self.path.split("?", 1)[0] != "/a2a":
                    self.send_response(404)
                    self.end_headers()
                    return
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length)
                try:
                    rpc = json.loads(raw.decode("utf-8"))
                except Exception as error:  # noqa: BLE001 - the wire error is the response
                    self._write(_error(None, -32700, f"Parse error: {error}"))
                    return
                if not isinstance(rpc, dict):
                    self._write(_error(None, -32700, "Parse error: body must be an object"))
                    return
                try:
                    self._write(server_instance.handle_rpc(rpc))
                except ValueError as error:
                    self._write(_error(rpc.get("id"), -32602, str(error)))

            def _write(self, payload: Dict[str, Any]) -> None:
                encoded = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(encoded)

        httpd = HTTPServer((self.host, self.port), RequestHandler)
        self.port = httpd.server_address[1]
        return httpd

    @property
    def base_url(self) -> str:
        return f"http://{self.host}:{self.port}"

    def start(self) -> None:
        httpd = self.serve()
        card_url = f"{self.base_url}/.well-known/agent-card.json"
        print(f"Agent Taskbay Python helper listening on {self.base_url}")
        print(f"AGENT_CARD_URL={card_url}", flush=True)
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            httpd.server_close()


def _ok(rpc_id: Any, result: Any) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rpc_id, "result": result}


def _error(rpc_id: Any, code: int, message: str) -> Dict[str, Any]:
    return {"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}
