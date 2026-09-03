/**
 * Fabric host integration for the analyzer UI.
 *
 * When this app is embedded inside Microsoft Fabric (as a FERemote workload
 * frontend), it can pull a real semantic model straight from the workspace:
 *   1. open the Fabric Data Hub picker to choose a Semantic Model,
 *   2. acquire a Fabric API token from the host (no secrets in the browser),
 *   3. call getItemDefinition (TMSL) and decode the parts,
 *   4. hand the parts to the shared engine (loadModelFromParts + analyze).
 *
 * The SDK is loaded lazily so the standalone GitHub Pages playground never
 * depends on it. All API shapes below mirror the official Extensibility Toolkit
 * clients (@ms-fabric/workload-client 3.x).
 */
import type { DefinitionPart } from "../src/index.js";

// Types are erased at build time; the runtime import is lazy (see getClient()).
import type { WorkloadClientAPI } from "@ms-fabric/workload-client";

const FABRIC_API_BASE = "https://api.fabric.microsoft.com/v1";
const READ_SCOPES = [
  "https://api.fabric.microsoft.com/Item.Read.All",
  "https://api.fabric.microsoft.com/Workspace.Read.All",
];

/** Heuristic: Fabric loads the workload frontend inside an iframe. */
export function isEmbeddedInFabric(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Cross-origin access throws → we're framed by another origin (Fabric).
    return true;
  }
}

export interface FabricModel {
  parts: DefinitionPart[];
  name: string;
}

let clientPromise: Promise<WorkloadClientAPI> | null = null;

async function getClient(): Promise<WorkloadClientAPI> {
  if (!clientPromise) {
    clientPromise = import("@ms-fabric/workload-client").then((m) => m.createWorkloadClient());
  }
  return clientPromise;
}

/**
 * Full flow: pick a semantic model in the Data Hub, fetch its definition, and
 * return decoded parts ready for `loadModelFromParts`. Returns null if the user
 * cancels the picker.
 */
export async function loadModelFromFabric(): Promise<FabricModel | null> {
  const client = await getClient();

  const selection = await pickSemanticModel(client);
  if (!selection) return null;

  const token = await acquireToken(client);
  const parts = await fetchDefinition(token, selection.workspaceId, selection.itemId);
  return { parts, name: selection.displayName || selection.itemId };
}

interface Selection {
  workspaceId: string;
  itemId: string;
  displayName?: string;
}

async function pickSemanticModel(client: WorkloadClientAPI): Promise<Selection | null> {
  // datahub.openDialog config mirrors the toolkit's DataHubController.
  const result = await (client as any).datahub.openDialog({
    supportedTypes: ["SemanticModel"],
    multiSelectionEnabled: false,
    dialogDescription: "Select a semantic model to analyze",
    workspaceNavigationEnabled: true,
    hostDetails: {
      experience: "Semantic Model Analyzer",
      scenario: "Select semantic model",
    },
  });

  const sel = result?.selectedDatahubItem?.[0];
  if (!sel) return null;
  return {
    workspaceId: sel.workspaceObjectId,
    itemId: sel.itemObjectId,
    displayName: sel.datahubItemUI?.displayName,
  };
}

async function acquireToken(client: WorkloadClientAPI): Promise<string> {
  const accessToken = await client.auth.acquireFrontendAccessToken({ scopes: READ_SCOPES });
  return accessToken.token;
}

/** getItemDefinition with long-running-operation polling, using browser fetch. */
async function fetchDefinition(
  token: string,
  workspaceId: string,
  itemId: string,
  timeoutMs = 120_000,
): Promise<DefinitionPart[]> {
  const url = `${FABRIC_API_BASE}/workspaces/${encodeURIComponent(workspaceId)}/items/${encodeURIComponent(
    itemId,
  )}/getDefinition?format=TMSL`;

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
  });

  if (response.status === 200) {
    const body = await response.json();
    return decodeParts(body?.definition?.parts ?? []);
  }

  if (response.status === 202) {
    const location = response.headers.get("Location");
    if (!location) throw new Error("getDefinition accepted but no Location header was returned.");
    let delay = (Number(response.headers.get("Retry-After")) || 2) * 1000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await sleep(delay);
      const statusResp = await fetch(location, { headers: { Authorization: `Bearer ${token}` } });
      if (!statusResp.ok) throw new Error(`Operation status ${statusResp.status}`);
      const status = await statusResp.json();
      const state = String(status?.status ?? "").toLowerCase();
      if (state === "succeeded") {
        const resultResp = await fetch(`${location}/result`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!resultResp.ok) throw new Error(`Operation result ${resultResp.status}`);
        const body = await resultResp.json();
        return decodeParts(body?.definition?.parts ?? []);
      }
      if (state === "failed") throw new Error("getDefinition operation failed.");
      const nextRetry = Number(statusResp.headers.get("Retry-After"));
      if (nextRetry > 0) delay = nextRetry * 1000;
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for getDefinition.`);
  }

  const detail = await response.text().catch(() => "");
  throw new Error(`getDefinition failed: HTTP ${response.status} ${response.statusText} ${detail}`);
}

interface RawPart {
  path: string;
  payload: string;
  payloadType: string;
}

function decodeParts(parts: RawPart[]): DefinitionPart[] {
  return parts.map((p) => ({
    path: p.path,
    content: p.payloadType === "InlineBase64" ? base64ToUtf8(p.payload) : p.payload,
  }));
}

function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
