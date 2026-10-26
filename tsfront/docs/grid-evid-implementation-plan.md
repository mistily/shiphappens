# GRID-EVID implementation plan

## 1. Problem and intended outcome

Data-center operators make scheduling choices from separate workload, SLA, grid-carbon, renewable forecast, energy-price, capacity, thermal, and storage systems. GRID-EVID turns those inputs into a traceable schedule recommendation without allowing a language model or forecast to override deterministic safety rules.

The operator receives per-workload shift, hold, or review decisions; quantified emissions and cost deltas; source and freshness details; and a record of how agents challenged the plan. People remain accountable for approval. Approval records a decision and is not represented as a live infrastructure dispatch.

## 2. Working implementation

The first build accepts a structured scenario containing sites, workloads, forecast windows, safety settings, and provenance-bearing evidence. It persists every run and its shared agent state in PostgreSQL, exposes an API and operator console, and supports an explicitly labeled synthetic reference scenario for repeatable evaluation. An operator can also submit their own scenario JSON.

The result includes a durable run history, per-workload recommendations, estimated carbon and cost deltas, evidence references, agent trace, human decision, and retrospective shadow outcomes. Shadow outcomes update source-level forecast-error memory used by later evaluations.

## 3. Agent workflow and shared state

1. **Planner** validates the objective and dynamically delegates evidence reconciliation and capacity analysis based on the scenario's sites, flexible workload count, and available evidence.
2. **Evidence agent** joins each forecast window to its source claim, checks provenance, confidence, age, and missing or contradictory signals. It retries reconciliation once; it never invents replacement readings.
3. **SLA/capacity agent** checks runtime against the SLA deadline and permitted delay, then reserves capacity across selected workload windows so the plan cannot overbook a site.
4. **Decision agent** proposes shift, hold, or review actions and computes estimates from the supplied data.
5. **Deterministic critic** independently checks the schedule invariants. A failed check triggers one bounded planner revision; if validation still fails, the affected workload falls back to hold or review.
6. **Grid critic** compares source forecasts with persisted retrospective errors. Poor historical calibration lowers confidence and can exclude a source, forcing a revision or a human review.
7. **Safety agent** applies the non-bypassable SLA, site-temperature, grid-frequency, capacity, evidence-quality, and uncertainty floors.
8. **Reporter** emits the final operator-facing explanation and trace. The run record is the shared state for every agent and survives reloads.

Every trace entry records the responsible role, stage, attempt, outcome, concise rationale, evidence references, and timestamp. The LLM/NVIDIA path is optional and is not a dependency for deterministic decisions or safety.

## 4. Decision math and safety rules

- Estimated carbon saved (kg CO₂) = `(baseline gCO₂/kWh − target gCO₂/kWh) × workload kWh ÷ 1000`.
- Estimated cost delta (EUR) = `(target EUR/MWh − baseline EUR/MWh) × workload kWh ÷ 1000`. Positive means additional cost; negative means savings.
- A shift is considered only for flexible workloads with a current baseline window, when the target fits runtime, SLA deadline, and maximum delay; the site has headroom; thermal and supplied grid-frequency readings are within configured limits; the evidence is present and fresh; and the carbon delta is positive.
- Missing/stale evidence, uncertain forecasts, missing required safety telemetry, contradictory evidence, and poorly calibrated sources produce review/hold outcomes, not fabricated certainty.
- Safety thresholds are deterministic. Optional model reasoning can criticize evidence or explain tradeoffs, but cannot clear a failed gate.
- Estimates are scenario calculations, not audited or calibrated emissions guarantees.

## 5. Data and provider boundaries

The supplied `mistily/shiphappens` repository is a FastAPI starter. Its planner/researcher/executor registry returns placeholder summaries and its Compass client only probes a generic health endpoint; it does not implement the named GRID-EVID integrations.

Replit's integration catalog did not expose Zetaris, Meterless Engines, or Nightshift. Their concrete API contracts were not supplied. The build therefore does not claim that these systems are connected and does not fabricate vendor responses:

- **Zetaris** is the intended federated source-data adapter.
- **Meterless Engines** is an intended optional intelligence/analysis adapter.
- **Nightshift** is an intended optional workflow/coordination adapter.
- **NVIDIA** is optional and not required for the deterministic agent loop.
- PostgreSQL stores GRID-EVID's own runs, decisions, and calibration memory. Operator-supplied evidence is usable without a vendor connection.

Provider adapters must remain read-only until the service contracts and scopes are confirmed. Any future execution/dispatch adapter must be idempotent, auditable, human-gated, and fail closed. Credentials belong in Replit Secrets, never in scenario JSON or source code.

## 6. Delivery sequence

### Phase A — usable core (current)

- Contract-first API, persistent runs, deterministic multi-agent orchestration, bounded revision and fallback.
- Operator console for submitting scenarios, reviewing trace and recommendations, deciding on escalations, and recording shadow outcomes.
- Provider status that accurately reports unconfigured adapters.
- Synthetic reference case clearly labeled for repeatable judging and validation.

### Phase B — connect real evidence

- Confirm Zetaris API/SQL access model, schemas, and read scopes.
- Implement a read-only Zetaris adapter that maps the agreed grid, forecast, workload, and hardware records into the scenario contract.
- Preserve source record IDs and timestamps end to end; reject partial or stale pulls visibly.

### Phase C — optional intelligence

- Confirm Meterless Engines and Nightshift contracts and what each service is authoritative for.
- Add independent adapter calls with timeouts, retries, idempotency keys, trace spans, and deterministic fallbacks. Keep the core workflow useful if either service is unavailable.
- Add NVIDIA only if its model materially improves evidence analysis; never place it inside the safety gate.

### Phase D — operational hardening

- Add operator identity/roles, tenant boundaries, retention policy, signed audit events, rate limits, and secure secret configuration before exposing business data publicly.
- Add provider contract tests, failure injection, SLA/capacity boundary tests, replayable historical evaluation, and forecast calibration monitoring.
- Enable workload dispatch only after an operator-controlled integration and rollback/compensation behavior are specified and verified.

## 7. Acceptance criteria

- A submitted scenario is validated and persisted; it remains available after reload.
- The run trace shows planning, evidence, capacity, decision, critique, safety, and reporting stages, including retries or escalation where triggered.
- Invalid or incomplete evidence never produces an unqualified shift recommendation.
- Unsafe SLA, capacity, thermal, or grid-frequency conditions cannot be approved by an AI agent.
- A human decision is persisted with operator, timestamp, and note.
- A shadow outcome computes forecast error and affects the source reliability memory used by a later run.
- Provider status clearly distinguishes unconfigured services from usable data; no disconnected vendor is described as live.
- Estimates display units, inputs, assumptions, and the direction of the cost delta.

## 8. Known scope boundary

Live Zetaris, Meterless Engines, and Nightshift connectivity is pending their API documentation/endpoints and authorization. This first build is an operational scenario-analysis and review system, not a live data-center scheduler or automatic actuator. It does not include multi-tenant authentication or claim compliance/certified carbon accounting.
