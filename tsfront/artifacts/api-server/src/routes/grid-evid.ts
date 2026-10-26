import { desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateGridRunBody,
  GetGridDashboardResponse,
  GetGridRunResponse,
  GetReferenceScenarioResponse,
  ListGridAgentsResponse,
  ListGridRunsResponse,
  RecordHumanDecisionBody,
  RecordShadowOutcomeBody,
  RecordShadowOutcomeResponse,
} from "@workspace/api-zod";
import {
  db,
  gridRunsTable,
  gridShadowOutcomesTable,
} from "@workspace/db";
import {
  orchestrateGridScenario,
  ScenarioValidationError,
  summarizeRun,
  updateRunWithHumanDecision,
  makeReferenceScenario,
} from "../services/grid-evid/orchestrator";
import { getProviderStatuses } from "../services/grid-evid/providers";

const router: IRouter = Router();

const AGENTS = [
  {
    id: "planner",
    name: "Planner",
    responsibility: "Builds a bounded plan and delegates work from scenario context.",
    delegatesWhen: "Always; selects evidence, capacity, and decision work from the supplied inputs.",
  },
  {
    id: "evidence",
    name: "Evidence",
    responsibility: "Joins forecasts to provenance and checks freshness, confidence, and conflicts.",
    delegatesWhen: "When grid windows or evidence records are present; missing evidence escalates.",
  },
  {
    id: "sla-capacity",
    name: "SLA / Capacity",
    responsibility: "Checks runtime, deadlines, maximum delay, site headroom, and reservations.",
    delegatesWhen: "When at least one flexible workload needs a scheduling decision.",
  },
  {
    id: "decision",
    name: "Decision",
    responsibility: "Compares safe windows and computes per-workload carbon and cost deltas.",
    delegatesWhen: "After evidence and capacity inputs have been reconciled.",
  },
  {
    id: "deterministic-critic",
    name: "Deterministic Critic",
    responsibility: "Independently validates SLA, capacity, target-window, and carbon invariants.",
    delegatesWhen: "On every proposed schedule; one bounded revision is allowed.",
  },
  {
    id: "grid-critic",
    name: "Grid Critic",
    responsibility: "Uses retrospective shadow outcomes to challenge poorly calibrated sources.",
    delegatesWhen: "When source calibration memory exists or a recommendation relies on forecasts.",
  },
  {
    id: "safety",
    name: "Safety",
    responsibility: "Applies non-bypassable thermal, grid-frequency, capacity, and SLA floors.",
    delegatesWhen: "On every run, after planner revision and independent critique.",
  },
  {
    id: "reporter",
    name: "Reporter",
    responsibility: "Produces operator-ready recommendations with provenance and limitations.",
    delegatesWhen: "After the final safety gate.",
  },
];

function errorBody(error: string, code: string) {
  return { error, code };
}

function serializeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function loadRun(runId: string) {
  const [row] = await db
    .select()
    .from(gridRunsTable)
    .where(eq(gridRunsTable.id, runId))
    .limit(1);
  if (!row) return null;
  return {
    row,
    run: GetGridRunResponse.parse(row.result),
  };
}

async function loadCalibrationSamples() {
  const rows = await db
    .select({
      sourceId: gridShadowOutcomesTable.sourceId,
      absolutePercentageError: gridShadowOutcomesTable.absolutePercentageError,
      observedAt: gridShadowOutcomesTable.observedAt,
    })
    .from(gridShadowOutcomesTable)
    .orderBy(desc(gridShadowOutcomesTable.observedAt))
    .limit(2000);
  return rows;
}

router.get("/dashboard", async (_req, res) => {
  try {
    const [totals] = await db
      .select({
        totalRuns: sql<number>`count(*)::int`,
        pendingReview: sql<number>`count(*) filter (where ${gridRunsTable.status} = 'needs_review')::int`,
        approvedRuns: sql<number>`count(*) filter (where ${gridRunsTable.status} = 'approved')::int`,
        shiftedWorkloads: sql<number>`coalesce(sum((result->>'shiftCount')::int), 0)::int`,
        estimatedCo2SavedKg: sql<number>`coalesce(sum((result->>'estimatedCo2SavedKg')::numeric), 0)::float8`,
        estimatedCostDeltaEur: sql<number>`coalesce(sum((result->>'estimatedCostDeltaEur')::numeric), 0)::float8`,
      })
      .from(gridRunsTable);
    const recentRows = await db
      .select({ result: gridRunsTable.result })
      .from(gridRunsTable)
      .orderBy(desc(gridRunsTable.createdAt))
      .limit(8);
    const recentRuns = recentRows.map((row) =>
      summarizeRun(GetGridRunResponse.parse(row.result)),
    );
    const providers = getProviderStatuses();

    res.json(
      GetGridDashboardResponse.parse({
        totalRuns: totals?.totalRuns ?? 0,
        pendingReview: totals?.pendingReview ?? 0,
        approvedRuns: totals?.approvedRuns ?? 0,
        shiftedWorkloads: totals?.shiftedWorkloads ?? 0,
        estimatedCo2SavedKg: Number(totals?.estimatedCo2SavedKg ?? 0),
        estimatedCostDeltaEur: Number(totals?.estimatedCostDeltaEur ?? 0),
        connectedProviders: providers.filter((provider) => provider.status === "connected").length,
        providerCount: providers.length,
        recentRuns,
      }),
    );
  } catch (error) {
    _req.log.error({ err: error }, "Failed to load Grid Evid dashboard");
    res.status(500).json(errorBody("Unable to load dashboard data.", "dashboard_failed"));
  }
});

router.get("/providers", (_req, res) => {
  res.json(getProviderStatuses());
});

router.get("/agents", (_req, res) => {
  res.json(ListGridAgentsResponse.parse(AGENTS));
});

router.get("/reference-scenario", (_req, res) => {
  res.json(GetReferenceScenarioResponse.parse(makeReferenceScenario()));
});

router.get("/runs", async (req, res) => {
  try {
    const rows = await db
      .select({ result: gridRunsTable.result })
      .from(gridRunsTable)
      .orderBy(desc(gridRunsTable.createdAt))
      .limit(100);
    const summaries = rows.map((row) =>
      summarizeRun(GetGridRunResponse.parse(row.result)),
    );
    res.json(ListGridRunsResponse.parse(summaries));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list Grid Evid runs");
    res.status(500).json(errorBody("Unable to load orchestration runs.", "runs_failed"));
  }
});

router.post("/runs", async (req, res) => {
  let scenario: ReturnType<typeof CreateGridRunBody.parse>;
  try {
    scenario = CreateGridRunBody.parse(req.body);
  } catch (error) {
    res.status(400).json(
      errorBody(
        error instanceof Error ? error.message : "Scenario validation failed.",
        "invalid_scenario",
      ),
    );
    return;
  }

  try {
    const run = await orchestrateGridScenario(scenario, await loadCalibrationSamples());
    await db.insert(gridRunsTable).values({
      id: run.id,
      name: run.name,
      status: run.status,
      summary: run.summary,
      input: serializeJson(scenario) as Record<string, unknown>,
      result: serializeJson(run) as Record<string, unknown>,
    });
    res.status(201).json(GetGridRunResponse.parse(run));
  } catch (error) {
    if (error instanceof ScenarioValidationError) {
      res.status(400).json(errorBody(error.message, "invalid_scenario_relationship"));
      return;
    }
    req.log.error({ err: error }, "Grid Evid orchestration failed");
    res.status(500).json(errorBody("Orchestration did not complete; no run was persisted.", "run_failed"));
  }
});

router.get("/runs/:runId", async (req, res) => {
  try {
    const loaded = await loadRun(req.params.runId);
    if (!loaded) {
      res.status(404).json(errorBody("Run not found.", "run_not_found"));
      return;
    }
    res.json(loaded.run);
  } catch (error) {
    req.log.error({ err: error, runId: req.params.runId }, "Failed to load Grid Evid run");
    res.status(500).json(errorBody("Unable to load run detail.", "run_detail_failed"));
  }
});

router.post("/runs/:runId/decision", async (req, res) => {
  let decision: ReturnType<typeof RecordHumanDecisionBody.parse>;
  try {
    decision = RecordHumanDecisionBody.parse(req.body);
  } catch (error) {
    res.status(400).json(
      errorBody(
        error instanceof Error ? error.message : "Decision validation failed.",
        "invalid_decision",
      ),
    );
    return;
  }

  try {
    const loaded = await loadRun(req.params.runId);
    if (!loaded) {
      res.status(404).json(errorBody("Run not found.", "run_not_found"));
      return;
    }
    if (loaded.run.status !== "needs_review") {
      res.status(409).json(errorBody("This run is not awaiting human review.", "decision_not_pending"));
      return;
    }
    if (
      decision.decision === "approve" &&
      loaded.run.recommendations.some(
        (recommendation) =>
          recommendation.action === "shift" &&
          recommendation.safetyFlags.length > 0,
      )
    ) {
      res.status(409).json(
        errorBody(
          "A human approval cannot override a failed deterministic safety gate.",
          "safety_gate_failed",
        ),
      );
      return;
    }
    const updated = updateRunWithHumanDecision(loaded.run, decision);
    await db
      .update(gridRunsTable)
      .set({
        status: updated.status,
        summary: updated.summary,
        result: serializeJson(updated) as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(gridRunsTable.id, req.params.runId));
    res.json(GetGridRunResponse.parse(updated));
  } catch (error) {
    req.log.error({ err: error, runId: req.params.runId }, "Failed to record human decision");
    res.status(500).json(errorBody("Unable to record the human decision.", "decision_failed"));
  }
});

router.post("/runs/:runId/shadow-outcomes", async (req, res) => {
  let outcome: ReturnType<typeof RecordShadowOutcomeBody.parse>;
  try {
    outcome = RecordShadowOutcomeBody.parse(req.body);
  } catch (error) {
    res.status(400).json(
      errorBody(
        error instanceof Error ? error.message : "Shadow outcome validation failed.",
        "invalid_shadow_outcome",
      ),
    );
    return;
  }

  try {
    const loaded = await loadRun(req.params.runId);
    if (!loaded) {
      res.status(404).json(errorBody("Run not found.", "run_not_found"));
      return;
    }
    const scenario = CreateGridRunBody.parse(loaded.row.input);
    const window = scenario.gridWindows.find(
      (item) => item.windowId === outcome.windowId,
    );
    if (!window) {
      res.status(400).json(
        errorBody("The selected grid window is not part of this run.", "window_not_in_run"),
      );
      return;
    }

    const absolutePercentageError =
      Math.abs(
        outcome.actualCarbonIntensityGco2PerKwh -
          window.carbonIntensityGco2PerKwh,
      ) / Math.max(Math.abs(outcome.actualCarbonIntensityGco2PerKwh), 1);
    const id = `${req.params.runId}:${window.windowId}`;
    await db
      .insert(gridShadowOutcomesTable)
      .values({
        id,
        runId: req.params.runId,
        windowId: window.windowId,
        sourceId: window.sourceId,
        forecastCarbonIntensityGco2PerKwh: window.carbonIntensityGco2PerKwh,
        actualCarbonIntensityGco2PerKwh: outcome.actualCarbonIntensityGco2PerKwh,
        absolutePercentageError,
        actualPriceEurPerMwh: outcome.actualPriceEurPerMwh,
        observedAt: outcome.observedAt,
      })
      .onConflictDoUpdate({
        target: [gridShadowOutcomesTable.runId, gridShadowOutcomesTable.windowId],
        set: {
          forecastCarbonIntensityGco2PerKwh: window.carbonIntensityGco2PerKwh,
          actualCarbonIntensityGco2PerKwh: outcome.actualCarbonIntensityGco2PerKwh,
          absolutePercentageError,
          actualPriceEurPerMwh: outcome.actualPriceEurPerMwh,
          observedAt: outcome.observedAt,
        },
      });

    const sourceRows = await db
      .select({ absolutePercentageError: gridShadowOutcomesTable.absolutePercentageError })
      .from(gridShadowOutcomesTable)
      .where(eq(gridShadowOutcomesTable.sourceId, window.sourceId))
      .orderBy(desc(gridShadowOutcomesTable.observedAt))
      .limit(100);
    const sourceMeanAbsolutePercentageError =
      sourceRows.reduce((sum, row) => sum + row.absolutePercentageError, 0) /
      Math.max(sourceRows.length, 1);

    res.status(201).json(
      RecordShadowOutcomeResponse.parse({
        id,
        runId: req.params.runId,
        windowId: window.windowId,
        sourceId: window.sourceId,
        forecastCarbonIntensityGco2PerKwh: window.carbonIntensityGco2PerKwh,
        actualCarbonIntensityGco2PerKwh: outcome.actualCarbonIntensityGco2PerKwh,
        forecastPriceEurPerMwh: window.priceEurPerMwh,
        actualPriceEurPerMwh: outcome.actualPriceEurPerMwh,
        absolutePercentageError,
        sourceMeanAbsolutePercentageError,
        observedAt: outcome.observedAt,
      }),
    );
  } catch (error) {
    req.log.error({ err: error, runId: req.params.runId }, "Failed to record shadow outcome");
    res.status(500).json(errorBody("Unable to record the observed outcome.", "shadow_outcome_failed"));
  }
});

export default router;
