import { randomUUID } from "node:crypto";
import {
  CreateGridRunBody,
  GetGridRunResponse,
  RecordHumanDecisionBody,
} from "@workspace/api-zod";

type Scenario = ReturnType<typeof CreateGridRunBody.parse>;
type RunDetail = ReturnType<typeof GetGridRunResponse.parse>;
type Workload = Scenario["workloads"][number];
type Site = Scenario["sites"][number];
type GridWindow = Scenario["gridWindows"][number];
type Evidence = Scenario["evidence"][number];
type Recommendation = RunDetail["recommendations"][number];
type TraceEntry = RunDetail["trace"][number];
type CalibrationMemory = RunDetail["calibrationMemory"][number];
type HumanDecisionInput = ReturnType<typeof RecordHumanDecisionBody.parse>;

export interface CalibrationSample {
  sourceId: string;
  absolutePercentageError: number;
  observedAt: Date;
}

export class ScenarioValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScenarioValidationError";
  }
}

const AGENTS = {
  planner: { id: "planner", name: "Planner" },
  evidence: { id: "evidence", name: "Evidence" },
  capacity: { id: "sla-capacity", name: "SLA / Capacity" },
  decision: { id: "decision", name: "Decision" },
  deterministicCritic: { id: "deterministic-critic", name: "Deterministic Critic" },
  gridCritic: { id: "grid-critic", name: "Grid Critic" },
  safety: { id: "safety", name: "Safety" },
  reporter: { id: "reporter", name: "Reporter" },
} as const;

const DEFAULT_POLICY = {
  minForecastConfidence: 0.75,
  maxEvidenceAgeMinutes: 240,
  minStorageChargePct: 15,
};

const POOR_CALIBRATION_MAPE = 0.15;
const MAX_REVISIONS = 1;

function asDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function normalizedId(value: string): string {
  return value.trim().toLocaleLowerCase("en");
}

function averagePowerMw(energyKwh: number, runtimeMinutes: number): number {
  return energyKwh / (runtimeMinutes / 60) / 1000;
}

function validateRelationships(scenario: Scenario): void {
  const siteIds = new Set(scenario.sites.map((site) => site.siteId));
  const workloadIds = scenario.workloads.map((workload) => workload.workloadId);
  const windowIds = scenario.gridWindows.map((window) => window.windowId);

  if (new Set(workloadIds).size !== workloadIds.length) {
    throw new ScenarioValidationError("Workload IDs must be unique within a scenario.");
  }
  if (new Set(windowIds).size !== windowIds.length) {
    throw new ScenarioValidationError("Grid window IDs must be unique within a scenario.");
  }
  if (new Set([...siteIds]).size !== scenario.sites.length) {
    throw new ScenarioValidationError("Site IDs must be unique within a scenario.");
  }

  for (const workload of scenario.workloads) {
    if (!siteIds.has(workload.siteId)) {
      throw new ScenarioValidationError(
        `Workload "${workload.workloadId}" references unknown site "${workload.siteId}".`,
      );
    }
    if (asDate(workload.slaDeadline).getTime() <= asDate(scenario.asOf).getTime()) {
      throw new ScenarioValidationError(
        `Workload "${workload.workloadId}" has an SLA deadline at or before scenario time.`,
      );
    }
  }

  for (const window of scenario.gridWindows) {
    if (!siteIds.has(window.siteId)) {
      throw new ScenarioValidationError(
        `Grid window "${window.windowId}" references unknown site "${window.siteId}".`,
      );
    }
    if (asDate(window.endsAt).getTime() <= asDate(window.startsAt).getTime()) {
      throw new ScenarioValidationError(
        `Grid window "${window.windowId}" must end after it starts.`,
      );
    }
  }
}

function buildCalibrationMemory(samples: CalibrationSample[]): CalibrationMemory[] {
  const groups = new Map<string, CalibrationSample[]>();
  for (const sample of samples) {
    const group = groups.get(sample.sourceId) ?? [];
    if (group.length < 100) group.push(sample);
    groups.set(sample.sourceId, group);
  }

  return [...groups.entries()]
    .map(([sourceId, values]) => ({
      sourceId,
      sampleCount: values.length,
      meanAbsolutePercentageError:
        values.reduce((sum, value) => sum + value.absolutePercentageError, 0) /
        Math.max(values.length, 1),
      lastObservedAt: values.reduce(
        (latest, value) => (value.observedAt > latest ? value.observedAt : latest),
        new Date(0),
      ),
    }))
    .sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}

function traceEntry(
  agentId: string,
  agentName: string,
  stage: string,
  attempt: number,
  outcome: TraceEntry["outcome"],
  summary: string,
  sourceReferences: string[] = [],
): TraceEntry {
  return {
    id: randomUUID(),
    agentId,
    agentName,
    stage,
    attempt,
    outcome,
    summary,
    sourceReferences: [...new Set(sourceReferences)],
    createdAt: new Date(),
  };
}

function getEvidenceForWindow(
  window: GridWindow,
  evidence: Evidence[],
): { matched: Evidence[]; recoveredByNormalizedId: boolean } {
  const exact = evidence.filter((item) => item.sourceId === window.sourceId);
  if (exact.length > 0) return { matched: exact, recoveredByNormalizedId: false };

  const normalized = normalizedId(window.sourceId);
  const recovered = evidence.filter(
    (item) => normalizedId(item.sourceId) === normalized,
  );
  return { matched: recovered, recoveredByNormalizedId: recovered.length > 0 };
}

function memoryForSource(
  sourceId: string,
  memory: CalibrationMemory[],
): CalibrationMemory | undefined {
  const normalized = normalizedId(sourceId);
  return memory.find((item) => normalizedId(item.sourceId) === normalized);
}

function siteFrequencyBounds(
  site: Site,
  scenario: Scenario,
): { min: number; max: number } {
  const explicitMin = scenario.safetyPolicy?.minGridFrequencyHz;
  const explicitMax = scenario.safetyPolicy?.maxGridFrequencyHz;
  if (explicitMin !== undefined && explicitMax !== undefined) {
    return { min: explicitMin, max: explicitMax };
  }
  return site.gridFrequencyHz !== undefined && site.gridFrequencyHz >= 55
    ? { min: 59.8, max: 60.2 }
    : { min: 49.8, max: 50.2 };
}

interface WindowAudit {
  flags: string[];
  evidenceIds: string[];
  confidence: number;
  hardBlocked: boolean;
  reviewRequired: boolean;
}

function auditWindow(
  window: GridWindow,
  site: Site,
  scenario: Scenario,
  calibration: CalibrationMemory[],
): WindowAudit {
  const policy = { ...DEFAULT_POLICY, ...scenario.safetyPolicy };
  const flags: string[] = [];
  const { matched, recoveredByNormalizedId } = getEvidenceForWindow(
    window,
    scenario.evidence,
  );
  const evidenceIds = matched.map((item) => item.sourceId);
  const nowMs = asDate(scenario.asOf).getTime();
  const evidenceAges = matched.map(
    (item) => (nowMs - asDate(item.observedAt).getTime()) / 60_000,
  );
  const tooOld =
    matched.length === 0 ||
    evidenceAges.some((age) => age > policy.maxEvidenceAgeMinutes);
  const fromFuture = evidenceAges.some((age) => age < -5);
  const lowEvidenceConfidence =
    matched.length > 0 &&
    matched.some((item) => item.confidence < policy.minForecastConfidence);
  const lowForecastConfidence =
    window.forecastConfidence < policy.minForecastConfidence;
  let confidence = Math.min(
    window.forecastConfidence,
    matched.length > 0 ? Math.min(...matched.map((item) => item.confidence)) : 0,
  );
  let hardBlocked = false;
  let reviewRequired = false;

  if (matched.length === 0) flags.push("evidence_missing");
  if (tooOld && matched.length > 0) flags.push("evidence_stale");
  if (fromFuture) flags.push("evidence_timestamp_in_future");
  if (lowEvidenceConfidence || lowForecastConfidence) flags.push("forecast_confidence_below_floor");
  if (recoveredByNormalizedId) flags.push("source_id_normalized_on_retry");

  if (matched.length === 0 || tooOld || fromFuture || lowEvidenceConfidence || lowForecastConfidence) {
    reviewRequired = true;
  }
  if (
    (window.renewableSharePct >= 80 && window.carbonIntensityGco2PerKwh >= 500) ||
    (window.renewableSharePct <= 5 && window.carbonIntensityGco2PerKwh <= 40)
  ) {
    flags.push("carbon_renewables_contradiction");
    reviewRequired = true;
  }

  const sourceMemory = memoryForSource(window.sourceId, calibration);
  if (sourceMemory && sourceMemory.sampleCount >= 2) {
    if (sourceMemory.meanAbsolutePercentageError > POOR_CALIBRATION_MAPE) {
      flags.push("source_miscalibrated");
      confidence *= Math.max(0.25, 1 - sourceMemory.meanAbsolutePercentageError);
      reviewRequired = true;
    }
  }

  if (site.temperatureC >= site.maxTemperatureC) {
    flags.push("thermal_limit_reached");
    hardBlocked = true;
  }

  if (site.gridFrequencyHz === undefined) {
    flags.push("grid_frequency_unobserved");
    reviewRequired = true;
  } else {
    const frequencyBounds = siteFrequencyBounds(site, scenario);
    if (
      site.gridFrequencyHz < frequencyBounds.min ||
      site.gridFrequencyHz > frequencyBounds.max
    ) {
      flags.push("grid_frequency_anomaly");
      hardBlocked = true;
    }
  }

  if (
    site.storageChargePct !== undefined &&
    site.storageChargePct < policy.minStorageChargePct
  ) {
    flags.push("storage_reserve_below_floor");
    reviewRequired = true;
  }

  return {
    flags,
    evidenceIds,
    confidence: Math.max(0, Math.min(1, confidence)),
    hardBlocked,
    reviewRequired,
  };
}

interface Candidate {
  window: GridWindow;
  carbonSavedKg: number;
  costDeltaEur: number;
  confidence: number;
  flags: string[];
  evidenceIds: string[];
}

function planRecommendations(
  scenario: Scenario,
  calibration: CalibrationMemory[],
  excludedSources: Set<string>,
  attempt: number,
  trace: TraceEntry[],
): Recommendation[] {
  const asOfMs = asDate(scenario.asOf).getTime();
  const siteById = new Map(scenario.sites.map((site) => [site.siteId, site]));
  const reservedMw = new Map<string, number>();
  const recommendations: Recommendation[] = [];
  const orderedWorkloads = [...scenario.workloads].sort((a, b) => {
    const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
    return (
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      asDate(a.slaDeadline).getTime() - asDate(b.slaDeadline).getTime()
    );
  });

  for (const workload of orderedWorkloads) {
    const site = siteById.get(workload.siteId);
    if (!site) continue;

    const siteWindows = scenario.gridWindows
      .filter((window) => window.siteId === workload.siteId)
      .sort((a, b) => asDate(a.startsAt).getTime() - asDate(b.startsAt).getTime());
    const currentBaseline = siteWindows
      .filter(
        (window) =>
          asDate(window.startsAt).getTime() <= asOfMs &&
          asDate(window.endsAt).getTime() > asOfMs,
      )
      .sort((a, b) => asDate(b.startsAt).getTime() - asDate(a.startsAt).getTime())[0];
    const baseline =
      currentBaseline ??
      siteWindows.find((window) => asDate(window.startsAt).getTime() > asOfMs);
    const refs: string[] = [];

    if (!baseline) {
      recommendations.push({
        workloadId: workload.workloadId,
        workloadName: workload.name,
        action: "review",
        targetWindowId: null,
        estimatedCo2SavedKg: 0,
        estimatedCostDeltaEur: 0,
        confidence: 0,
        reason: "No current or future grid window is available for a baseline comparison.",
        safetyFlags: ["baseline_window_missing"],
        evidenceSourceIds: [],
      });
      continue;
    }

    const baselineAudit = auditWindow(baseline, site, scenario, calibration);
    if (!currentBaseline) {
      baselineAudit.flags.push("current_baseline_missing");
      baselineAudit.reviewRequired = true;
    }
    refs.push(...baselineAudit.evidenceIds);

    if (!workload.flexible) {
      recommendations.push({
        workloadId: workload.workloadId,
        workloadName: workload.name,
        action: "hold",
        targetWindowId: null,
        estimatedCo2SavedKg: 0,
        estimatedCostDeltaEur: 0,
        confidence: baselineAudit.confidence,
        reason: "This workload is marked inflexible, so the scheduler will not move it.",
        safetyFlags: [],
        evidenceSourceIds: refs,
      });
      continue;
    }

    const candidateResults: Candidate[] = [];
    const reviewFlags = new Set(baselineAudit.flags);
    const baselineHasUncertainty =
      baselineAudit.reviewRequired || baselineAudit.hardBlocked;

    for (const window of siteWindows) {
      if (window.windowId === baseline.windowId) continue;
      if (asDate(window.startsAt).getTime() <= asOfMs) continue;

      const audit = auditWindow(window, site, scenario, calibration);
      const flags = [...audit.flags];
      const delayMinutes =
        (asDate(window.startsAt).getTime() - asOfMs) / 60_000;
      const runtimeMs = workload.runtimeMinutes * 60_000;
      const windowDurationMs =
        asDate(window.endsAt).getTime() - asDate(window.startsAt).getTime();
      const deadlineMs = asDate(workload.slaDeadline).getTime();
      const runEndMs = asDate(window.startsAt).getTime() + runtimeMs;
      const averageMw = averagePowerMw(workload.energyKwh, workload.runtimeMinutes);
      const capacityKey = `${window.siteId}:${window.windowId}`;
      const reserved = reservedMw.get(capacityKey) ?? 0;
      const availableMw = site.capacityMw - site.scheduledLoadMw - reserved;

      if (delayMinutes > workload.maxDelayMinutes) flags.push("max_delay_exceeded");
      if (windowDurationMs < runtimeMs || runEndMs > deadlineMs) {
        flags.push("sla_window_infeasible");
      }
      if (availableMw < averageMw) flags.push("site_capacity_exceeded");
      if (baselineHasUncertainty) flags.push("baseline_evidence_uncertain");
      if (excludedSources.has(normalizedId(window.sourceId))) {
        flags.push("source_excluded_after_critique");
      }

      const carbonSavedKg =
        ((baseline.carbonIntensityGco2PerKwh -
          window.carbonIntensityGco2PerKwh) *
          workload.energyKwh) /
        1000;
      const costDeltaEur =
        ((window.priceEurPerMwh - baseline.priceEurPerMwh) *
          workload.energyKwh) /
        1000;
      if (carbonSavedKg <= 0) flags.push("no_carbon_improvement");

      for (const flag of flags) {
        if (
          flag === "evidence_missing" ||
          flag === "evidence_stale" ||
          flag === "evidence_timestamp_in_future" ||
          flag === "forecast_confidence_below_floor" ||
          flag === "carbon_renewables_contradiction" ||
          flag === "source_miscalibrated" ||
          flag === "grid_frequency_unobserved" ||
          flag === "storage_reserve_below_floor" ||
          flag === "baseline_evidence_uncertain"
        ) {
          reviewFlags.add(flag);
        }
      }

      candidateResults.push({
        window,
        carbonSavedKg,
        costDeltaEur,
        confidence: Math.min(audit.confidence, baselineAudit.confidence),
        flags: [...new Set(flags)],
        evidenceIds: [...baselineAudit.evidenceIds, ...audit.evidenceIds],
      });
    }

    const eligible = candidateResults
      .filter((candidate) => candidate.carbonSavedKg > 0 && candidate.flags.length === 0)
      .sort(
        (a, b) =>
          b.carbonSavedKg - a.carbonSavedKg ||
          a.costDeltaEur - b.costDeltaEur,
      );
    const best = eligible[0];

    if (!best) {
      const allFlags = new Set(reviewFlags);
      for (const candidate of candidateResults) {
        for (const flag of candidate.flags) {
          if (flag !== "no_carbon_improvement") allFlags.add(flag);
        }
      }
      const requiresReview = allFlags.size > 0;
      const reason = !currentBaseline
        ? "No current grid window is available as a baseline. Future-window comparisons require operator review."
        : candidateResults.length === 0
          ? "No future window is available within the workload's scheduling horizon."
          : "No target window passed the carbon, evidence, SLA, capacity, and safety checks.";
      recommendations.push({
        workloadId: workload.workloadId,
        workloadName: workload.name,
        action: requiresReview ? "review" : "hold",
        targetWindowId: null,
        estimatedCo2SavedKg: 0,
        estimatedCostDeltaEur: 0,
        confidence: baselineAudit.confidence,
        reason,
        safetyFlags: [...allFlags],
        evidenceSourceIds: [...new Set(candidateResults.flatMap((item) => item.evidenceIds).concat(refs))],
      });
      continue;
    }

    if (workload.priority === "critical") {
      recommendations.push({
        workloadId: workload.workloadId,
        workloadName: workload.name,
        action: "review",
        targetWindowId: best.window.windowId,
        estimatedCo2SavedKg: best.carbonSavedKg,
        estimatedCostDeltaEur: best.costDeltaEur,
        confidence: best.confidence,
        reason: "A lower-carbon window exists, but critical-priority workloads require explicit operator review.",
        safetyFlags: ["critical_priority_human_review"],
        evidenceSourceIds: best.evidenceIds,
      });
      continue;
    }

    const capacityKey = `${best.window.siteId}:${best.window.windowId}`;
    const additionalMw = averagePowerMw(workload.energyKwh, workload.runtimeMinutes);
    reservedMw.set(capacityKey, (reservedMw.get(capacityKey) ?? 0) + additionalMw);
    const costNote =
      best.costDeltaEur > 0
        ? ` Estimated energy spend increases by €${best.costDeltaEur.toFixed(2)}.`
        : best.costDeltaEur < 0
          ? ` Estimated energy spend decreases by €${Math.abs(best.costDeltaEur).toFixed(2)}.`
          : " Estimated energy spend is unchanged.";
    recommendations.push({
      workloadId: workload.workloadId,
      workloadName: workload.name,
      action: "shift",
      targetWindowId: best.window.windowId,
      estimatedCo2SavedKg: best.carbonSavedKg,
      estimatedCostDeltaEur: best.costDeltaEur,
      confidence: best.confidence,
      reason: `The target window has lower forecast carbon intensity, and it passes the current evidence, SLA, site capacity, and safety checks.${costNote}`,
      safetyFlags: [],
      evidenceSourceIds: best.evidenceIds,
    });
  }

  trace.push(
    traceEntry(
      AGENTS.decision.id,
      AGENTS.decision.name,
      "decision",
      attempt,
      "completed",
      `Evaluated ${scenario.workloads.length} workloads and selected ${recommendations.filter((item) => item.action === "shift").length} shifts; no workload was dispatched.`,
      recommendations.flatMap((item) => item.evidenceSourceIds),
    ),
  );
  return recommendations;
}

function validateRecommendations(
  scenario: Scenario,
  recommendations: Recommendation[],
): string[] {
  const workloadById = new Map(
    scenario.workloads.map((workload) => [workload.workloadId, workload]),
  );
  const siteById = new Map(scenario.sites.map((site) => [site.siteId, site]));
  const findings: string[] = [];

  for (const recommendation of recommendations) {
    if (recommendation.action !== "shift") continue;
    const workload = workloadById.get(recommendation.workloadId);
    const target = scenario.gridWindows.find(
      (window) => window.windowId === recommendation.targetWindowId,
    );
    const site = workload ? siteById.get(workload.siteId) : undefined;
    if (!workload || !target || !site) {
      findings.push(recommendation.workloadId);
      continue;
    }
    const fitsSla =
      asDate(target.startsAt).getTime() +
        workload.runtimeMinutes * 60_000 <=
      asDate(workload.slaDeadline).getTime();
    const noFlags = recommendation.safetyFlags.length === 0;
    const positiveSavings = recommendation.estimatedCo2SavedKg > 0;
    if (!fitsSla || !noFlags || !positiveSavings) {
      findings.push(recommendation.workloadId);
    }
  }
  return findings;
}

export async function orchestrateGridScenario(
  scenario: Scenario,
  calibrationSamples: CalibrationSample[],
): Promise<RunDetail> {
  validateRelationships(scenario);
  const calibrationMemory = buildCalibrationMemory(calibrationSamples);
  const trace: TraceEntry[] = [];
  const siteCount = scenario.sites.length;
  const flexibleCount = scenario.workloads.filter((workload) => workload.flexible).length;
  const dynamicDelegations = [
    "evidence",
    ...(flexibleCount > 0 ? ["sla-capacity"] : []),
    "decision",
  ];

  trace.push(
    traceEntry(
      AGENTS.planner.id,
      AGENTS.planner.name,
      "planning",
      1,
      "completed",
      `Built a plan for ${scenario.workloads.length} workloads across ${siteCount} sites. Delegated ${dynamicDelegations.join(", ")} based on scenario content.`,
      scenario.evidence.map((item) => item.sourceId),
    ),
  );

  const evidenceAudit = scenario.gridWindows.map((window) => {
    const { matched, recoveredByNormalizedId } = getEvidenceForWindow(
      window,
      scenario.evidence,
    );
    return {
      window,
      matched,
      recoveredByNormalizedId,
      stale:
        matched.length === 0 ||
        matched.some(
          (item) =>
            (asDate(scenario.asOf).getTime() -
              asDate(item.observedAt).getTime()) /
              60_000 >
            (scenario.safetyPolicy?.maxEvidenceAgeMinutes ??
              DEFAULT_POLICY.maxEvidenceAgeMinutes),
        ),
    };
  });
  const missingEvidence = evidenceAudit.filter((item) => item.matched.length === 0);
  const staleEvidence = evidenceAudit.filter((item) => item.stale && item.matched.length > 0);
  const recoveredEvidence = evidenceAudit.filter(
    (item) => item.recoveredByNormalizedId,
  );
  trace.push(
    traceEntry(
      AGENTS.evidence.id,
      AGENTS.evidence.name,
      "provenance_reconciliation",
      recoveredEvidence.length > 0 ? 2 : 1,
      missingEvidence.length > 0
        ? "escalated"
        : recoveredEvidence.length > 0
          ? "recovered"
          : "completed",
      `${scenario.gridWindows.length - missingEvidence.length} of ${scenario.gridWindows.length} windows joined to source evidence; ${staleEvidence.length} stale and ${missingEvidence.length} missing. Source-ID normalization was used for ${recoveredEvidence.length} recovery matches.`,
      scenario.evidence.map((item) => item.sourceId),
    ),
  );

  trace.push(
    traceEntry(
      AGENTS.capacity.id,
      AGENTS.capacity.name,
      "sla_capacity_precheck",
      1,
      "completed",
      `Checked runtime, SLA horizon, site telemetry, and cumulative capacity reservations for ${flexibleCount} flexible workloads.`,
      scenario.sites.map((site) => site.siteId),
    ),
  );

  const initialRecommendations = planRecommendations(
    scenario,
    [],
    new Set(),
    1,
    trace,
  );

  const unreliableSources = new Set(
    calibrationMemory
      .filter(
        (memory) =>
          memory.sampleCount >= 2 &&
          memory.meanAbsolutePercentageError > POOR_CALIBRATION_MAPE,
      )
      .map((memory) => normalizedId(memory.sourceId)),
  );
  const exposedUnreliableSource = initialRecommendations.some((recommendation) => {
    if (recommendation.action !== "shift" || !recommendation.targetWindowId) return false;
    const window = scenario.gridWindows.find(
      (candidate) => candidate.windowId === recommendation.targetWindowId,
    );
    return window ? unreliableSources.has(normalizedId(window.sourceId)) : false;
  });

  let recommendations = initialRecommendations;
  let revisionCount = 0;
  if (exposedUnreliableSource && revisionCount < MAX_REVISIONS) {
    trace.push(
      traceEntry(
        AGENTS.gridCritic.id,
        AGENTS.gridCritic.name,
        "historical_forecast_critique",
        1,
        "retrying",
        "A proposed source exceeded the 15% mean absolute percentage error tolerance across at least two shadow observations. Replanning without that source.",
        [...unreliableSources],
      ),
    );
    revisionCount += 1;
    recommendations = planRecommendations(
      scenario,
      calibrationMemory,
      unreliableSources,
      2,
      trace,
    );
    trace.push(
      traceEntry(
        AGENTS.planner.id,
        AGENTS.planner.name,
        "revision",
        2,
        "recovered",
        `Revised the schedule after excluding ${unreliableSources.size} poorly calibrated source(s).`,
        [...unreliableSources],
      ),
    );
  } else {
    trace.push(
      traceEntry(
        AGENTS.gridCritic.id,
        AGENTS.gridCritic.name,
        "historical_forecast_critique",
        1,
        "completed",
        calibrationMemory.length === 0
          ? "No retrospective source calibration is available yet; recommendations retain input confidence and disclose this limitation."
          : `Compared the proposed schedule with ${calibrationMemory.length} calibrated source(s); no selected source crossed the revision threshold.`,
        calibrationMemory.map((item) => item.sourceId),
      ),
    );
  }

  let invalidShifts = validateRecommendations(scenario, recommendations);
  if (invalidShifts.length > 0 && revisionCount < MAX_REVISIONS) {
    trace.push(
      traceEntry(
        AGENTS.deterministicCritic.id,
        AGENTS.deterministicCritic.name,
        "schedule_invariant_critique",
        1,
        "retrying",
        `Rejected ${invalidShifts.length} proposed shift(s) that failed independent invariants; replanning once.`,
        invalidShifts,
      ),
    );
    revisionCount += 1;
    const excludedWindows = new Set(
      recommendations
        .filter((recommendation) => invalidShifts.includes(recommendation.workloadId))
        .map((recommendation) => recommendation.targetWindowId)
        .filter((id): id is string => Boolean(id)),
    );
    recommendations = planRecommendations(
      {
        ...scenario,
        gridWindows: scenario.gridWindows.filter(
          (window) => !excludedWindows.has(window.windowId),
        ),
      },
      calibrationMemory,
      unreliableSources,
      2,
      trace,
    );
    invalidShifts = validateRecommendations(scenario, recommendations);
  }

  if (invalidShifts.length > 0) {
    recommendations = recommendations.map((recommendation) =>
      invalidShifts.includes(recommendation.workloadId)
        ? {
            ...recommendation,
            action: "hold",
            targetWindowId: null,
            estimatedCo2SavedKg: 0,
            estimatedCostDeltaEur: 0,
            safetyFlags: [...recommendation.safetyFlags, "critic_invariant_failed"],
            reason:
              "The independent schedule check did not pass after its bounded retry. The workload remains on hold.",
          }
        : recommendation,
    );
  }

  trace.push(
    traceEntry(
      AGENTS.deterministicCritic.id,
      AGENTS.deterministicCritic.name,
      "schedule_invariant_critique",
      revisionCount > 0 ? 2 : 1,
      invalidShifts.length > 0 ? "blocked" : "completed",
      invalidShifts.length > 0
        ? `Safety invariants still failed for ${invalidShifts.length} workload(s); those workloads were held.`
        : "Verified every proposed shift against workload SLA, positive carbon savings, and an empty safety-flag set.",
      recommendations.flatMap((item) => item.evidenceSourceIds),
    ),
  );

  const workloadById = new Map(
    scenario.workloads.map((workload) => [workload.workloadId, workload]),
  );
  recommendations = recommendations.map((recommendation) => {
    const workload = workloadById.get(recommendation.workloadId);
    if (workload?.priority === "critical" && recommendation.action === "shift") {
      return {
        ...recommendation,
        action: "review",
        safetyFlags: ["critical_priority_human_review"],
        reason:
          "A lower-carbon window passed the deterministic checks, but critical-priority workloads require explicit operator review.",
      };
    }
    return recommendation;
  });

  const hardSafetyFlags = new Set([
    "thermal_limit_reached",
    "grid_frequency_anomaly",
    "site_capacity_exceeded",
    "sla_window_infeasible",
    "max_delay_exceeded",
    "critic_invariant_failed",
  ]);
  const safetyChanges: string[] = [];
  recommendations = recommendations.map((recommendation) => {
    const failedHardGate = recommendation.safetyFlags.some((flag) =>
      hardSafetyFlags.has(flag),
    );
    if (recommendation.action === "shift" && failedHardGate) {
      safetyChanges.push(recommendation.workloadId);
      return {
        ...recommendation,
        action: "hold",
        targetWindowId: null,
        estimatedCo2SavedKg: 0,
        estimatedCostDeltaEur: 0,
        reason:
          "A deterministic safety gate failed. No schedule change is recommended; human approval cannot override this hold.",
      };
    }
    return recommendation;
  });

  trace.push(
    traceEntry(
      AGENTS.safety.id,
      AGENTS.safety.name,
      "non_bypassable_safety_gate",
      1,
      safetyChanges.length > 0 ? "blocked" : "completed",
      safetyChanges.length > 0
        ? `Blocked ${safetyChanges.length} workload shift(s) after the final deterministic safety check.`
        : "Final check passed: no proposed shift bypasses SLA, capacity, thermal, or grid-frequency limits.",
      recommendations.flatMap((item) => item.evidenceSourceIds),
    ),
  );

  const shiftCount = recommendations.filter((item) => item.action === "shift").length;
  const holdCount = recommendations.filter((item) => item.action === "hold").length;
  const reviewCount = recommendations.filter((item) => item.action === "review").length;
  const estimatedCo2SavedKg = recommendations.reduce(
    (sum, item) => sum + (item.action === "shift" ? item.estimatedCo2SavedKg : 0),
    0,
  );
  const estimatedCostDeltaEur = recommendations.reduce(
    (sum, item) => sum + (item.action === "shift" ? item.estimatedCostDeltaEur : 0),
    0,
  );
  const requiresReview =
    reviewCount > 0 ||
    recommendations.some((item) => item.safetyFlags.length > 0);
  const status: RunDetail["status"] = requiresReview ? "needs_review" : "completed";
  const summary = [
    `${recommendations.length} workload decision(s): ${shiftCount} proposed shift(s), ${holdCount} hold(s), ${reviewCount} review(s).`,
    `Estimated emissions avoided: ${estimatedCo2SavedKg.toFixed(2)} kg CO₂.`,
    `Estimated energy cost delta: €${estimatedCostDeltaEur.toFixed(2)} (positive means higher cost).`,
    requiresReview ? "Human review is required." : "No human escalation was triggered.",
  ].join(" ");

  trace.push(
    traceEntry(
      AGENTS.reporter.id,
      AGENTS.reporter.name,
      "report",
      1,
      "completed",
      "Produced a traceable operator report. Estimates use submitted evidence and are not certified emissions or cost guarantees.",
      recommendations.flatMap((item) => item.evidenceSourceIds),
    ),
  );

  return GetGridRunResponse.parse({
    id: randomUUID(),
    name: scenario.name,
    status,
    createdAt: new Date(),
    workloadCount: scenario.workloads.length,
    shiftCount,
    holdCount,
    reviewCount,
    estimatedCo2SavedKg,
    estimatedCostDeltaEur,
    revisionCount,
    summary,
    recommendations,
    trace,
    evidence: scenario.evidence,
    calibrationMemory,
    executionMode: "operator-supplied scenario · no external workload dispatch",
  });
}

export function makeReferenceScenario(): Scenario {
  const asOf = new Date();
  const addMinutes = (minutes: number) => new Date(asOf.getTime() + minutes * 60_000);
  const sourceId = "synthetic-reference-grid-source";
  const scenario = {
    name: "Synthetic reference case — not live grid data",
    asOf,
    sites: [
      {
        siteId: "site-east-1",
        name: "East Campus",
        region: "RO-NE",
        capacityMw: 18,
        scheduledLoadMw: 13,
        temperatureC: 67,
        maxTemperatureC: 82,
        storageChargePct: 46,
        gridFrequencyHz: 50.01,
      },
    ],
    workloads: [
      {
        workloadId: "batch-forecast-refresh",
        name: "Forecast model refresh",
        siteId: "site-east-1",
        energyKwh: 3600,
        runtimeMinutes: 60,
        slaDeadline: addMinutes(420),
        maxDelayMinutes: 240,
        flexible: true,
        priority: "normal",
      },
      {
        workloadId: "batch-etl-reconcile",
        name: "Daily warehouse reconciliation",
        siteId: "site-east-1",
        energyKwh: 2400,
        runtimeMinutes: 60,
        slaDeadline: addMinutes(360),
        maxDelayMinutes: 180,
        flexible: true,
        priority: "high",
      },
    ],
    gridWindows: [
      {
        windowId: "window-current",
        siteId: "site-east-1",
        startsAt: addMinutes(-60),
        endsAt: addMinutes(60),
        carbonIntensityGco2PerKwh: 510,
        forecastConfidence: 0.96,
        priceEurPerMwh: 91,
        renewableSharePct: 38,
        sourceId,
        observedAt: asOf,
      },
      {
        windowId: "window-clean-2h",
        siteId: "site-east-1",
        startsAt: addMinutes(120),
        endsAt: addMinutes(180),
        carbonIntensityGco2PerKwh: 365,
        forecastConfidence: 0.89,
        priceEurPerMwh: 97,
        renewableSharePct: 61,
        sourceId,
        observedAt: asOf,
      },
      {
        windowId: "window-clean-4h",
        siteId: "site-east-1",
        startsAt: addMinutes(240),
        endsAt: addMinutes(300),
        carbonIntensityGco2PerKwh: 278,
        forecastConfidence: 0.84,
        priceEurPerMwh: 95,
        renewableSharePct: 73,
        sourceId,
        observedAt: asOf,
      },
    ],
    evidence: [
      {
        sourceId,
        sourceName: "Synthetic reference profile",
        provider: "operator_upload",
        category: "carbon_intensity",
        claim: "Illustrative grid forecast and pricing for repeatable workflow validation.",
        recordReference: "synthetic-reference-v1",
        observedAt: asOf,
        confidence: 0.9,
        notes: "Synthetic fixture only. Not a live provider, meter, or verified forecast.",
      },
    ],
    safetyPolicy: {
      minForecastConfidence: DEFAULT_POLICY.minForecastConfidence,
      maxEvidenceAgeMinutes: DEFAULT_POLICY.maxEvidenceAgeMinutes,
      minGridFrequencyHz: 49.8,
      maxGridFrequencyHz: 50.2,
      minStorageChargePct: DEFAULT_POLICY.minStorageChargePct,
    },
  };
  return CreateGridRunBody.parse(scenario);
}

export function summarizeRun(run: RunDetail): Omit<
  RunDetail,
  "summary" | "recommendations" | "trace" | "evidence" | "humanDecision" | "calibrationMemory" | "executionMode"
> {
  const {
    summary: _summary,
    recommendations: _recommendations,
    trace: _trace,
    evidence: _evidence,
    humanDecision: _humanDecision,
    calibrationMemory: _calibrationMemory,
    executionMode: _executionMode,
    ...result
  } = run;
  return result;
}

export function updateRunWithHumanDecision(
  run: RunDetail,
  input: HumanDecisionInput,
): RunDetail {
  const updated = {
    ...run,
    status: input.decision === "approve" ? "approved" : "rejected",
    summary: `${run.summary} Operator decision: ${input.decision} by ${input.operator}. Approval records review only; no external workload was dispatched.`,
    humanDecision: {
      decision: input.decision,
      operator: input.operator,
      note: input.note ?? "",
      decidedAt: new Date(),
    },
  };
  return GetGridRunResponse.parse(updated);
}
