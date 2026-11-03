"""
LangGraph Taskbay Adapter Example
Demonstrates how to use Agent Taskbay as an out-of-process human-in-the-loop interrupt gate.
"""

import sys
import time
from typing import Dict, Any, TypedDict, Literal

# Define state structure
class AgentState(TypedDict):
    plan: str
    target_action: str
    risk_level: Literal["low", "medium", "high"]
    approved: bool
    execution_result: str


def plan_step(state: AgentState) -> Dict[str, Any]:
    print("\n[LangGraph] Step 1: Planning agent action...")
    action = state.get("target_action", "DROP TABLE users_archive_2025;")
    return {
        "plan": f"Execute critical database maintenance: {action}",
        "risk_level": "high" if "DROP" in action or "DELETE" in action else "low",
        "approved": False
    }


def should_interrupt_for_taskbay(state: AgentState) -> Literal["request_taskbay_approval", "execute"]:
    if state.get("risk_level") == "high" and not state.get("approved"):
        return "request_taskbay_approval"
    return "execute"


def request_taskbay_approval(state: AgentState) -> Dict[str, Any]:
    """
    Simulates / performs the out-of-process delegation to Agent Taskbay.
    In production, an A2A agent publishes this task state as `auth-required`
    with the approval-request extension on http://127.0.0.1:3002.
    """
    print("\n[LangGraph -> Taskbay] Step 2: High-risk action detected.")
    print(f"Creating durable approval gate in Agent Taskbay:")
    print(f"  • Title: Approve Database DDL Execution")
    print(f"  • Risk Level: {state['risk_level'].upper()}")
    print(f"  • Proposed Statement: {state['target_action']}")
    print(f"  • Console URL: http://127.0.0.1:3002/inbox")
    print("\n[Taskbay Console] Waiting for human operator sign-off...")
    
    # In live execution, Taskbay workers hold the durable state in SQLite/PGlite.
    # The LangGraph worker can safely release memory and poll or await a webhook callback.
    time.sleep(1.5)
    
    # Simulated approval received from Taskbay console
    print("[Taskbay Console] Decision delivered: APPROVED by operator (admin@local)")
    print("[Taskbay Console] Exact revision lock verified (revision 1).")
    
    return {"approved": True}


def execute_step(state: AgentState) -> Dict[str, Any]:
    print("\n[LangGraph] Step 3: Executing approved action...")
    if not state.get("approved"):
        raise PermissionError("Action blocked: Human approval not granted!")
    result = f"Successfully executed: {state['target_action']}"
    print(f"[Execution Engine] {result}")
    return {"execution_result": result}


def main():
    print("=" * 60)
    print("Agent Taskbay + LangGraph Human-in-the-Loop Integration")
    print("=" * 60)

    try:
        from langgraph.graph import StateGraph, END

        builder = StateGraph(AgentState)
        builder.add_node("plan", plan_step)
        builder.add_node("request_taskbay_approval", request_taskbay_approval)
        builder.add_node("execute", execute_step)

        builder.set_entry_point("plan")
        builder.add_conditional_edges(
            "plan",
            should_interrupt_for_taskbay,
            {
                "request_taskbay_approval": "request_taskbay_approval",
                "execute": "execute",
            }
        )
        builder.add_edge("request_taskbay_approval", "execute")
        builder.add_edge("execute", END)

        graph = builder.compile()
        initial_state: AgentState = {
            "plan": "",
            "target_action": "DROP TABLE users_archive_2025 CASCADE;",
            "risk_level": "high",
            "approved": False,
            "execution_result": ""
        }
        final_state = graph.invoke(initial_state)
        print("\nWorkflow completed successfully!")
        print(f"Result: {final_state['execution_result']}")

    except ImportError:
        print("\nNotice: langgraph is not installed in the local environment.")
        print("Running pure-Python demonstration of the graph state machine...\n")
        
        state: AgentState = {
            "plan": "",
            "target_action": "DROP TABLE users_archive_2025 CASCADE;",
            "risk_level": "high",
            "approved": False,
            "execution_result": ""
        }
        
        state.update(plan_step(state))
        decision = should_interrupt_for_taskbay(state)
        if decision == "request_taskbay_approval":
            state.update(request_taskbay_approval(state))
        state.update(execute_step(state))
        
        print("\nWorkflow completed successfully!")
        print(f"Result: {state['execution_result']}")


if __name__ == "__main__":
    main()
