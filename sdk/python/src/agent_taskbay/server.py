"""
Lightweight HTTP server exposing the A2A Agent Card and handling Taskbay requests.
"""

import json
import uuid
import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Callable, Dict, Any, Optional

from .card import AgentCard
from .approvals import OperatorResponse, APPROVAL_MEDIA_TYPE


class AgentServer:
    def __init__(self, card: AgentCard, host: str = "127.0.0.1", port: int = 5050):
        self.card = card
        self.host = host
        self.port = port
        self.tasks: Dict[str, Any] = {}
        self._handler_callback: Optional[Callable[[str, str, OperatorResponse], Dict[str, Any]]] = None

    def on_task(self, fn: Callable[[str, str, OperatorResponse], Dict[str, Any]]):
        self._handler_callback = fn
        return fn

    def start(self):
        server_instance = self

        class RequestHandler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                # Silent or formatted logging
                pass

            def do_GET(self):
                if self.path in ["/card.json", "/.well-known/agent.json"]:
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Access-Control-Allow-Origin", "*")
                    self.end_headers()
                    base_url = f"http://{server_instance.host}:{server_instance.port}"
                    card_data = server_instance.card.to_dict(base_url)
                    self.wfile.write(json.dumps(card_data, indent=2).encode("utf-8"))
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_POST(self):
                if self.path == "/a2a":
                    length = int(self.headers.get("Content-Length", 0))
                    body = self.rfile.read(length)
                    try:
                        rpc = json.loads(body.decode("utf-8"))
                    except Exception as e:
                        self._send_rpc_error(None, -32700, f"Parse error: {str(e)}")
                        return

                    rpc_id = rpc.get("id")
                    method = rpc.get("method")
                    params = rpc.get("params", {})

                    if method == "SendMessage":
                        self._handle_send_message(rpc_id, params)
                    elif method == "GetTask":
                        task_id = params.get("id")
                        task = server_instance.tasks.get(task_id)
                        if task:
                            self._send_rpc_success(rpc_id, task)
                        else:
                            self._send_rpc_error(rpc_id, -32001, "Task not found")
                    elif method == "ListTasks":
                        self._send_rpc_success(rpc_id, {
                            "tasks": list(server_instance.tasks.values()),
                            "pageSize": 50,
                            "totalSize": len(server_instance.tasks)
                        })
                    else:
                        self._send_rpc_error(rpc_id, -32601, f"Method not found: {method}")
                else:
                    self.send_response(404)
                    self.end_headers()

            def _handle_send_message(self, rpc_id, params):
                msg = params.get("message", {})
                task_id = msg.get("taskId")
                parts = msg.get("parts", [])
                user_text = " ".join([p.get("text", "") for p in parts if "text" in p]).strip()
                now = datetime.datetime.now(datetime.timezone.utc).isoformat()

                if task_id and task_id in server_instance.tasks:
                    task = server_instance.tasks[task_id]
                    task["history"].append(msg)
                    task["status"]["state"] = "TASK_STATE_COMPLETED"
                    task["status"]["timestamp"] = now
                    task["history"].append({
                        "messageId": f"{task_id}-m{len(task['history']) + 1}",
                        "role": "ROLE_AGENT",
                        "taskId": task_id,
                        "parts": [{"text": "Decision received. Task completed."}]
                    })
                    self._send_rpc_success(rpc_id, {"task": task})
                    return

                new_id = f"task-{uuid.uuid4().hex[:8]}"
                operator_resp = OperatorResponse(new_id)

                if server_instance._handler_callback:
                    res = server_instance._handler_callback(new_id, user_text, operator_resp)
                else:
                    res = operator_resp.complete(f"Acknowledged: {user_text}")

                if res.get("type") == "approval":
                    approval = res["approval"]
                    parts_data = [
                        {"text": f"Agent proposed action requiring human review: {approval.title}"},
                        {"mediaType": APPROVAL_MEDIA_TYPE, "text": json.dumps(approval.to_dict())}
                    ]
                    state = "TASK_STATE_INPUT_REQUIRED"
                else:
                    parts_data = [{"text": res.get("message", "Task completed.")}]
                    state = "TASK_STATE_COMPLETED"

                task = {
                    "id": new_id,
                    "status": {
                        "state": state,
                        "timestamp": now,
                        "message": {
                            "messageId": f"{new_id}-m1",
                            "role": "ROLE_AGENT",
                            "taskId": new_id,
                            "parts": parts_data
                        }
                    },
                    "history": [
                        {
                            "messageId": f"{new_id}-m1",
                            "role": "ROLE_AGENT",
                            "taskId": new_id,
                            "parts": parts_data
                        }
                    ],
                    "artifacts": [],
                    "metadata": {"title": f"Task: {user_text[:30] or 'Direct'}"}
                }
                server_instance.tasks[new_id] = task
                self._send_rpc_success(rpc_id, {"task": task})

            def _send_rpc_success(self, rpc_id, result):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"jsonrpc": "2.0", "id": rpc_id, "result": result}).encode("utf-8"))

            def _send_rpc_error(self, rpc_id, code, message):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"jsonrpc": "2.0", "id": rpc_id, "error": {"code": code, "message": message}}).encode("utf-8"))

        httpd = HTTPServer((self.host, self.port), RequestHandler)
        print(f"Agent Taskbay Python Server listening on http://{self.host}:{self.port}")
        print(f"Agent Card available at http://{self.host}:{self.port}/card.json")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            httpd.server_close()
