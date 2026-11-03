#!/usr/bin/env python3
"""
Python A2A Reference Agent for Agent Taskbay
Demonstrates a standalone Python agent implementing the A2A JSON-RPC protocol
with the Taskbay human approval request extension.
"""

import json
import sys
from http.server import HTTPServer, BaseHTTPRequestHandler
import uuid
import datetime

PORT = 5050
HOST = "127.0.0.1"

APPROVAL_EXTENSION_URI = "https://extensions.allsrc.dev/agent-taskbay/approval-request/v1"
APPROVAL_MEDIA_TYPE = "application/vnd.agent-taskbay.approval-request+json"

# In-memory tasks store
TASKS = {}


class A2AAgentHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path in ["/card.json", "/.well-known/agent.json"]:
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()

            card = {
                "name": "Python Ops Agent",
                "description": "Python service agent providing automated infrastructure and database operations with human approvals.",
                "version": "1.0.0",
                "supportedInterfaces": [
                    {
                        "url": f"http://{HOST}:{PORT}/a2a",
                        "protocolBinding": "JSONRPC",
                        "protocolVersion": "1.0"
                    }
                ],
                "capabilities": {
                    "streaming": False,
                    "pushNotifications": False,
                    "extensions": [APPROVAL_EXTENSION_URI]
                },
                "defaultInputModes": ["text/plain"],
                "defaultOutputModes": ["text/plain"],
                "skills": [
                    {
                        "id": "migrate-database",
                        "name": "Database Migration",
                        "description": "Applies database schema migrations with human verification.",
                        "tags": ["ops", "database"],
                        "examples": ["migrate production db", "apply migration 0042"]
                    }
                ]
            }
            self.wfile.write(json.dumps(card, indent=2).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/a2a":
            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length)
            try:
                rpc = json.loads(raw_body.decode("utf-8"))
            except Exception as e:
                self.send_error_response(None, -32700, f"Parse error: {str(e)}")
                return

            rpc_id = rpc.get("id")
            method = rpc.get("method")
            params = rpc.get("params", {})

            if method == "SendMessage":
                self.handle_send_message(rpc_id, params)
            elif method == "GetTask":
                task_id = params.get("id")
                task = TASKS.get(task_id)
                if task:
                    self.send_success_response(rpc_id, task)
                else:
                    self.send_error_response(rpc_id, -32001, "Task not found")
            elif method == "ListTasks":
                self.send_success_response(rpc_id, {
                    "tasks": list(TASKS.values()),
                    "pageSize": 50,
                    "totalSize": len(TASKS)
                })
            else:
                self.send_error_response(rpc_id, -32601, f"Method not found: {method}")
        else:
            self.send_response(404)
            self.end_headers()

    def handle_send_message(self, rpc_id, params):
        message = params.get("message", {})
        task_id = message.get("taskId")
        parts = message.get("parts", [])
        user_text = " ".join([p.get("text", "") for p in parts if "text" in p]).strip()

        now = datetime.datetime.now(datetime.timezone.utc).isoformat()

        if task_id and task_id in TASKS:
            # Resuming existing task (e.g., human operator replied or approved)
            task = TASKS[task_id]
            task["history"].append(message)

            # Check if this message is an approval decision
            approval_decision = None
            for p in parts:
                if p.get("mediaType") == APPROVAL_MEDIA_TYPE:
                    try:
                        approval_decision = json.loads(p.get("text", "{}"))
                    except Exception:
                        pass

            if approval_decision and approval_decision.get("decision") == "approved":
                task["status"]["state"] = "TASK_STATE_COMPLETED"
                task["status"]["timestamp"] = now
                task["history"].append({
                    "messageId": f"{task_id}-m{len(task['history']) + 1}",
                    "role": "ROLE_AGENT",
                    "taskId": task_id,
                    "parts": [{
                        "text": "Migration verified and executed successfully against production cluster."
                    }]
                })
            else:
                task["status"]["state"] = "TASK_STATE_COMPLETED"
                task["status"]["timestamp"] = now
                task["history"].append({
                    "messageId": f"{task_id}-m{len(task['history']) + 1}",
                    "role": "ROLE_AGENT",
                    "taskId": task_id,
                    "parts": [{
                        "text": f"Received operator instruction: {user_text}. Work finished."
                    }]
                })

            self.send_success_response(rpc_id, {"task": task})
            return

        # New task
        new_task_id = f"py-task-{uuid.uuid4().hex[:8]}"
        approval_request = {
            "title": "Production Database Schema Migration",
            "riskLevel": "high",
            "description": "Execute schema migration script `20261103_add_indices.sql` affecting 4.2M rows.",
            "action": {
                "type": "database_migration",
                "database": "production_primary",
                "script": "CREATE INDEX CONCURRENTLY idx_audit_created ON audit_logs(created_at);"
            },
            "revision": 1
        }

        task = {
            "id": new_task_id,
            "status": {
                "state": "TASK_STATE_INPUT_REQUIRED",
                "timestamp": now,
                "message": {
                    "messageId": f"{new_task_id}-m1",
                    "role": "ROLE_AGENT",
                    "taskId": new_task_id,
                    "parts": [
                        {
                            "text": f"Initiating database migration for request: \"{user_text}\". High-risk human approval required before proceeding."
                        },
                        {
                            "mediaType": APPROVAL_MEDIA_TYPE,
                            "text": json.dumps(approval_request)
                        }
                    ]
                }
            },
            "history": [
                {
                    "messageId": f"{new_task_id}-m1",
                    "role": "ROLE_AGENT",
                    "taskId": new_task_id,
                    "parts": [
                        {
                            "text": f"Initiating database migration for request: \"{user_text}\". High-risk human approval required before proceeding."
                        },
                        {
                            "mediaType": APPROVAL_MEDIA_TYPE,
                            "text": json.dumps(approval_request)
                        }
                    ]
                }
            ],
            "artifacts": [],
            "metadata": {
                "title": f"Migrate Database ({user_text or 'Manual'})"
            }
        }
        TASKS[new_task_id] = task

        self.send_success_response(rpc_id, {"task": task})

    def send_success_response(self, rpc_id, result):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        response = {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": result
        }
        self.wfile.write(json.dumps(response).encode("utf-8"))

    def send_error_response(self, rpc_id, code, message):
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        response = {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": {"code": code, "message": message}
        }
        self.wfile.write(json.dumps(response).encode("utf-8"))


def main():
    server = HTTPServer((HOST, PORT), A2AAgentHandler)
    print("=" * 60)
    print(f"Python A2A Agent running at http://{HOST}:{PORT}")
    print(f"Agent Card URL: http://{HOST}:{PORT}/card.json")
    print(f"Compatible with Agent Taskbay on http://127.0.0.1:3002")
    print("Press Ctrl+C to terminate.")
    print("=" * 60)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down agent...")
        server.server_close()


if __name__ == "__main__":
    main()
