"""
Tests for Agent Taskbay Python SDK
"""

import unittest
from agent_taskbay.card import AgentCard, Skill, APPROVAL_EXTENSION_URI
from agent_taskbay.approvals import ApprovalRequest, OperatorResponse


class TestAgentTaskbaySDK(unittest.TestCase):
    def test_skill_serialization(self):
        s = Skill(id="test-skill", name="Test Skill", description="Tests skills", tags=["test"], examples=["run test"])
        d = s.to_dict()
        self.assertEqual(d["id"], "test-skill")
        self.assertEqual(d["name"], "Test Skill")
        self.assertIn("run test", d["examples"])

    def test_card_serialization(self):
        s = Skill(id="s1", name="Skill 1", description="desc")
        card = AgentCard(name="My Agent", description="An agent", skills=[s])
        d = card.to_dict("http://127.0.0.1:8000")
        self.assertEqual(d["name"], "My Agent")
        self.assertEqual(d["supportedInterfaces"][0]["url"], "http://127.0.0.1:8000/a2a")
        self.assertIn(APPROVAL_EXTENSION_URI, d["capabilities"]["extensions"])
        self.assertEqual(len(d["skills"]), 1)

    def test_approval_request(self):
        req = ApprovalRequest(
            title="Deploy Service",
            risk_level="high",
            action={"service": "api", "version": "1.0"},
            description="High risk deploy"
        )
        d = req.to_dict()
        self.assertEqual(d["title"], "Deploy Service")
        self.assertEqual(d["riskLevel"], "high")
        self.assertEqual(d["action"]["service"], "api")
        self.assertEqual(d["revision"], 1)

    def test_operator_response_helper(self):
        resp = OperatorResponse("task-123")
        appr = resp.request_approval(title="Confirm", risk_level="medium")
        self.assertEqual(appr["type"], "approval")
        self.assertEqual(appr["approval"].title, "Confirm")

        comp = resp.complete("All done!")
        self.assertEqual(comp["type"], "complete")
        self.assertEqual(comp["message"], "All done!")


if __name__ == "__main__":
    unittest.main()
