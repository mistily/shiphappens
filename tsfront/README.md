# GRID-EVID

Explainable carbon-aware workload orchestration for data-center operators. GRID-EVID evaluates submitted workload, SLA, grid, forecast, price, and hardware evidence; specialist agents critique scheduling proposals; deterministic safety gates and operator decisions remain authoritative.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/grid-evid run dev` — run the operator console when the artifact workflow supplies its port and base path
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/grid-evid/src/` — operator console, scenario intake, run review, shadow outcomes
- `artifacts/api-server/src/routes/grid-evid.ts` — `/api/grid-evid` API handlers
- `artifacts/api-server/src/services/grid-evid/` — orchestration, safety gates, calibration logic, and provider contract slots
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/db/src/schema/grid-evid.ts` — persisted run and shadow-outcome tables
- `docs/grid-evid-implementation-plan.md` — detailed system plan, agent graph, thresholds, integration sequence, and acceptance criteria

## Architecture decisions

- Deterministic SLA, capacity, thermal, and grid-frequency gates run after agent critique and cannot be overridden by model reasoning or human approval.
- Scenario evidence is provenance-bearing input; the app never substitutes fabricated provider readings when a connector is unavailable.
- Retrospective shadow outcomes persist source error memory; a source that exceeds the calibration tolerance is challenged and the schedule is revised once.
- A human approval records review only. It does not dispatch or reschedule production workloads.

## Product

- Submit operator scenarios as JSON or load the explicitly labeled synthetic reference case.
- Review per-workload shift/hold/review recommendations, emissions and energy-cost deltas, evidence provenance, and the full agent trace.
- Record human decisions and actual shadow outcomes; future runs use the resulting source-calibration memory.
- See provider connectivity truthfully. Zetaris, Meterless Engines, Nightshift, and optional NVIDIA adapters remain inactive until their API contracts and credentials are configured.

## User preferences

- AI recommends. AI explains. Humans decide.
- NVIDIA model usage is optional; the core workflow must not depend on it.

## Gotchas

- The reference scenario is synthetic and is not a live grid feed or a carbon-savings guarantee.
- Positive `estimatedCostDeltaEur` means additional cost; negative means savings. CO₂ estimates are kg and use submitted gCO₂/kWh inputs.
- Provider API protocols are not yet known; configured endpoint variables alone do not activate or verify a provider adapter.
- The first build has no authentication or tenant isolation. Do not expose operational or sensitive business data publicly before adding access control.
- Approval never bypasses a deterministic hold and never executes a workload.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
