"""Illustrative sketch of a LangGraph branch that might later ask for approval.

This file does not open a socket and does not talk to Agent Taskbay. A real bridge
is not in this repository. LangGraph's own ``interrupt()``, with a checkpointer,
already pauses a graph durably; this sketch does not call that either.
"""

from typing import Any, Dict, Literal, TypedDict


class AgentState(TypedDict):
    plan: str
    target_action: str
    risk_level: Literal["low", "medium", "high"]
    approved: bool
    execution_result: str


def plan_step(state: AgentState) -> Dict[str, Any]:
    action = state.get("target_action", "DROP TABLE users_archive_2025;")
    return {
        "plan": f"Proposed database statement: {action}",
        "risk_level": "high" if "DROP" in action or "DELETE" in action else "low",
        "approved": False,
    }


def should_pause(state: AgentState) -> Literal["pause", "execute"]:
    if state.get("risk_level") == "high" and not state.get("approved"):
        return "pause"
    return "execute"


def pause_for_review(state: AgentState) -> Dict[str, Any]:
    print("Sketch only: no Agent Taskbay request was sent, and nothing was approved.")
    print(f"  Statement that would need a person: {state['target_action']}")
    return {"approved": False}


def execute_step(state: AgentState) -> Dict[str, Any]:
    if not state.get("approved"):
        print("Stopped before execution. A sketch cannot approve its own statement.")
        return {"execution_result": "not executed"}
    return {"execution_result": f"Executed: {state['target_action']}"}


def main() -> None:
    print("LangGraph sketch. This process does not contact Agent Taskbay.")
    state: AgentState = {
        "plan": "",
        "target_action": "DROP TABLE users_archive_2025 CASCADE;",
        "risk_level": "high",
        "approved": False,
        "execution_result": "",
    }
    try:
        from langgraph.graph import END, StateGraph

        builder = StateGraph(AgentState)
        builder.add_node("plan", plan_step)
        builder.add_node("pause", pause_for_review)
        builder.add_node("execute", execute_step)
        builder.set_entry_point("plan")
        builder.add_conditional_edges("plan", should_pause, {"pause": "pause", "execute": "execute"})
        builder.add_edge("pause", "execute")
        builder.add_edge("execute", END)
        final_state = builder.compile().invoke(state)
        print(final_state["execution_result"])
    except ImportError:
        print("langgraph is not installed. Running the same steps in plain Python.")
        state.update(plan_step(state))
        if should_pause(state) == "pause":
            state.update(pause_for_review(state))
        state.update(execute_step(state))
        print(state["execution_result"])


if __name__ == "__main__":
    main()
