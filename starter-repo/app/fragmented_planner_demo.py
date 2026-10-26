# name=starter-repo/app/fragmented_planner_demo.py
from app.planner_agent import load_fragments, normalize_fragments, build_fallback_plan

def run_demo():
    fragments = load_fragments("starter-repo/data")
    normalized = normalize_fragments(fragments)

    plan = build_fallback_plan(
        task="Design a provider-selection workflow using fragmented data and deterministic scoring.",
        context={
            "use_case": "fragmented-intelligence",
            "region": "emea",
            "priority": "balanced",
        },
        fragments=fragments,
    )

    print(plan.model_dump_json(indent=2))
