import { GetGridProvidersResponse } from "@workspace/api-zod";

export type ProviderStatus = ReturnType<typeof GetGridProvidersResponse.parse>[number];

export interface GridEvidProviderAdapter {
  readonly id: string;
  status(): ProviderStatus;
}

class ContractPendingAdapter implements GridEvidProviderAdapter {
  constructor(
    readonly id: string,
    private readonly name: string,
    private readonly role: string,
    private readonly endpointVariable: string,
    private readonly credentialVariable: string,
    private readonly optional = false,
  ) {}

  status(): ProviderStatus {
    const endpointConfigured = Boolean(process.env[this.endpointVariable]);
    const credentialConfigured = Boolean(process.env[this.credentialVariable]);
    const fullyConfigured = endpointConfigured && credentialConfigured;
    const partiallyConfigured = endpointConfigured || credentialConfigured;

    let detail: string;
    if (fullyConfigured) {
      detail =
        "Configuration is present, but the service protocol and health check are not verified. No provider requests are sent.";
    } else if (partiallyConfigured) {
      detail =
        "Configuration is incomplete. The adapter remains inactive until the endpoint, credentials, and provider contract are confirmed.";
    } else if (this.optional) {
      detail = "Optional adapter is not configured; core orchestration does not depend on it.";
    } else {
      detail =
        "Not connected. Supply the provider API contract and configure credentials in Replit Secrets before enabling this adapter.";
    }

    return {
      id: this.id,
      name: this.name,
      role: this.role,
      status: fullyConfigured || partiallyConfigured ? "degraded" : "unconfigured",
      adapter: "Fail-closed provider contract slot",
      detail,
    };
  }
}

const providerAdapters: GridEvidProviderAdapter[] = [
  new ContractPendingAdapter(
    "zetaris",
    "Zetaris",
    "Federated evidence and workload data",
    "GRID_EVID_ZETARIS_BASE_URL",
    "GRID_EVID_ZETARIS_TOKEN",
  ),
  new ContractPendingAdapter(
    "meterless",
    "Meterless Engines",
    "Optional intelligence and analysis",
    "GRID_EVID_METERLESS_BASE_URL",
    "GRID_EVID_METERLESS_TOKEN",
  ),
  new ContractPendingAdapter(
    "nightshift",
    "Nightshift",
    "Optional workflow coordination",
    "GRID_EVID_NIGHTSHIFT_BASE_URL",
    "GRID_EVID_NIGHTSHIFT_TOKEN",
  ),
  new ContractPendingAdapter(
    "nvidia",
    "NVIDIA NIM",
    "Optional non-safety model reasoning",
    "GRID_EVID_NVIDIA_BASE_URL",
    "GRID_EVID_NVIDIA_TOKEN",
    true,
  ),
];

export function getProviderStatuses(): ProviderStatus[] {
  return GetGridProvidersResponse.parse(providerAdapters.map((adapter) => adapter.status()));
}
