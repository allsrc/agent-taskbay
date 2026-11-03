"""Tests for the experimental Python agent helper.

These assert the wire shape Agent Taskbay reads (a data part, extension objects,
and approve-only-when-the-digest-matches). They do not start the console.
"""

import json
import threading
import unittest
import urllib.request

from agent_taskbay.approvals import (
    APPROVAL_MEDIA_TYPE,
    ApprovalRequest,
    OperatorResponse,
    action_digest,
    interpret_follow_up,
)
from agent_taskbay.card import APPROVAL_EXTENSION_URI, AgentCard, Skill
from agent_taskbay.server import AgentServer


PROPOSED = "Yes, delete staging"
# SHA-256 of {"data":null,"kind":"send_message","text":"Yes, delete staging"} with sorted keys.
# Same bytes as canonicalJson + sha256 in src/server/application/services/event-identity.ts.
DIGEST = "5f81e3cfc9d4f4e385d108af5d4f435f48c5baa9d961d329007582fa5c2dcee7"


def _approval_message(text, approval, *, data=None):
    metadata = {"approval": approval}
    if data is not None:
        metadata["decision"] = data
    return {"parts": [{"text": text}], "metadata": metadata}


class TestApprovalShape(unittest.TestCase):
    def test_digest_matches_the_console_canonical_form(self):
        self.assertEqual(action_digest({"kind": "send_message", "text": PROPOSED}), DIGEST)

    def test_part_is_data_with_the_fields_the_console_reads(self):
        request = ApprovalRequest(
            title="Delete the staging cluster",
            summary="Removes the staging nodes.",
            risk="high",
            expires_in_seconds=3600,
            action={"kind": "send_message", "text": PROPOSED},
        )
        part = request.to_part()
        self.assertNotIn("text", part)
        self.assertEqual(part["mediaType"], APPROVAL_MEDIA_TYPE)
        self.assertEqual(part["data"]["title"], "Delete the staging cluster")
        self.assertEqual(part["data"]["summary"], "Removes the staging nodes.")
        self.assertEqual(part["data"]["risk"], "high")
        self.assertEqual(part["data"]["expiresInSeconds"], 3600)
        self.assertEqual(part["data"]["action"], {"kind": "send_message", "text": PROPOSED})
        for invented in ("riskLevel", "description", "revision", "decision"):
            self.assertNotIn(invented, part["data"])

    def test_operator_requires_a_send_message_action(self):
        response = OperatorResponse("task-1").request_approval(
            "Deploy", "Approved. Deploy auth-service.", summary="Roll out v2.", risk="high"
        )
        self.assertEqual(response["type"], "approval")
        self.assertEqual(response["approval"].to_dict()["action"]["kind"], "send_message")
        self.assertEqual(OperatorResponse("task-1").complete("done")["type"], "complete")

    def test_follow_up_approves_only_a_matching_digest(self):
        pending = {"kind": "send_message", "text": PROPOSED}
        approval = {
            "requestId": "req-1",
            "decisionId": "dec-1",
            "revision": 1,
            "revisionDigest": DIGEST,
        }
        approved = interpret_follow_up(_approval_message(PROPOSED, approval), pending)
        self.assertEqual(approved["outcome"], "approved")
        self.assertEqual(approved["revisionDigest"], DIGEST)

        edited = "Approved. Delete only the unused volume."
        edited_digest = action_digest({"kind": "send_message", "text": edited})
        edited_approval = {**approval, "revision": 2, "revisionDigest": edited_digest}
        self.assertEqual(
            interpret_follow_up(_approval_message(edited, edited_approval), pending)["outcome"],
            "approved",
        )
        self.assertEqual(interpret_follow_up({"parts": [{"text": "rejected"}]}, pending)["reason"], "no_approval")
        self.assertEqual(
            interpret_follow_up(_approval_message(PROPOSED, {**approval, "revisionDigest": "a" * 64}), pending)["reason"],
            "digest_mismatch",
        )
        self.assertEqual(
            interpret_follow_up(_approval_message(PROPOSED, {**approval, "revision": "1"}), pending)["reason"],
            "bad_revision",
        )


class TestCard(unittest.TestCase):
    def test_extensions_are_objects_with_the_project_uri(self):
        card = AgentCard(name="Ops", description="Asks before acting", skills=[Skill("migrate", "Migrate", "Schema changes")])
        body = card.to_dict("http://127.0.0.1:5050")
        self.assertEqual(
            body["capabilities"]["extensions"],
            [{"uri": APPROVAL_EXTENSION_URI, "required": False}],
        )
        self.assertTrue(body["supportedInterfaces"][0]["url"].endswith("/a2a"))
        self.assertNotIn("a2a-protocol.org", json.dumps(body))


class TestServer(unittest.TestCase):
    def setUp(self):
        self.server = AgentServer(AgentCard(name="Ops", description="Asks before acting"), port=0)

        @self.server.on_task
        def handle(task_id, message, operator):
            return operator.request_approval("Delete the staging cluster", PROPOSED, summary="Asked from the test.", risk="high")

    def _open(self):
        opened = self.server.handle_rpc({"jsonrpc": "2.0", "id": 1, "method": "SendMessage", "params": {"message": {"parts": [{"text": "please approve"}]}}})
        task = opened["result"]["task"]
        part = task["status"]["message"]["parts"][1]
        self.assertEqual(part["mediaType"], APPROVAL_MEDIA_TYPE)
        self.assertEqual(part["data"]["action"]["kind"], "send_message")
        self.assertNotIn("text", part)
        self.assertEqual(task["status"]["state"], "TASK_STATE_INPUT_REQUIRED")
        return task

    def test_chat_reply_does_not_complete_and_approval_does(self):
        task = self._open()
        held = self.server.handle_rpc({
            "jsonrpc": "2.0", "id": 2, "method": "SendMessage",
            "params": {"message": {"taskId": task["id"], "contextId": task["contextId"], "parts": [{"text": "rejected"}]}},
        })["result"]["task"]
        self.assertEqual(held["status"]["state"], "TASK_STATE_INPUT_REQUIRED")
        self.assertIn("not an approved revision", held["history"][-1]["parts"][0]["text"])
        self.assertEqual(held["status"]["message"]["parts"][1]["data"]["title"], "Delete the staging cluster")

        approval = {"requestId": "req", "decisionId": "dec", "revision": 1, "revisionDigest": DIGEST}
        done = self.server.handle_rpc({
            "jsonrpc": "2.0", "id": 3, "method": "SendMessage",
            "params": {"message": {"taskId": task["id"], "parts": [{"text": PROPOSED}], "metadata": {"approval": approval}}},
        })["result"]["task"]
        self.assertEqual(done["status"]["state"], "TASK_STATE_COMPLETED")
        self.assertIn(DIGEST, done["status"]["message"]["parts"][0]["text"])
        again = self.server.handle_rpc({
            "jsonrpc": "2.0", "id": 4, "method": "SendMessage",
            "params": {"message": {"taskId": task["id"], "parts": [{"text": "do it again"}]}},
        })["result"]["task"]
        self.assertEqual(again["status"]["state"], "TASK_STATE_COMPLETED")
        self.assertEqual(again["status"]["message"]["messageId"], done["status"]["message"]["messageId"])

    def test_card_paths_over_http(self):
        httpd = self.server.serve()
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()

        def stop():
            httpd.shutdown()
            thread.join(timeout=2)
            httpd.server_close()

        self.addCleanup(stop)
        for path in ("/.well-known/agent-card.json", "/card.json"):
            with urllib.request.urlopen(f"{self.server.base_url}{path}") as response:
                card = json.load(response)
            self.assertEqual(card["capabilities"]["extensions"][0]["uri"], APPROVAL_EXTENSION_URI)
        with urllib.request.urlopen(f"{self.server.base_url}/a2a", data=json.dumps({
            "jsonrpc": "2.0", "id": "m", "method": "SendMessage", "params": {"message": {"parts": [{"text": "go"}]}}
        }).encode()) as response:
            body = json.load(response)
        part = body["result"]["task"]["status"]["message"]["parts"][1]
        self.assertEqual(part["data"]["risk"], "high")
        self.assertNotIn("text", part)


if __name__ == "__main__":
    unittest.main()
