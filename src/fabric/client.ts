import { getAccessToken, type AuthOptions } from "./auth.js";
import type { DefinitionPart } from "../model/load.js";

const FABRIC_BASE = "https://api.fabric.microsoft.com/v1";

export type DefinitionFormat = "TMSL" | "TMDL";

interface RawPart {
  path: string;
  payload: string;
  payloadType: string;
}

export interface GetDefinitionOptions extends AuthOptions {
  /** Definition format to request. Defaults to TMSL (most robust to parse). */
  format?: DefinitionFormat;
  /** Max time to wait for the long-running operation, in ms. */
  timeoutMs?: number;
}

/**
 * Client for the Fabric `getDefinition` REST API for semantic models.
 *
 * @see https://learn.microsoft.com/en-us/rest/api/fabric/semanticmodel/items/get-semantic-model-definition
 */
export class FabricClient {
  private tokenPromise: Promise<string>;

  constructor(private readonly auth: AuthOptions = {}) {
    this.tokenPromise = getAccessToken(auth);
  }

  /**
   * Retrieve and decode a semantic model's public definition parts.
   */
  async getSemanticModelDefinition(
    workspaceId: string,
    semanticModelId: string,
    options: GetDefinitionOptions = {},
  ): Promise<DefinitionPart[]> {
    const format = options.format ?? "TMSL";
    const url = `${FABRIC_BASE}/workspaces/${encodeURIComponent(workspaceId)}/semanticModels/${encodeURIComponent(
      semanticModelId,
    )}/getDefinition?format=${format}`;

    const response = await this.request("POST", url);
    const parts = await this.resolveDefinition(response, options.timeoutMs ?? 120_000);
    return parts.map(decodePart);
  }

  private async resolveDefinition(response: Response, timeoutMs: number): Promise<RawPart[]> {
    if (response.status === 200) {
      const body = (await response.json()) as { definition?: { parts?: RawPart[] } };
      return body.definition?.parts ?? [];
    }

    if (response.status === 202) {
      const location = response.headers.get("Location");
      if (!location) throw new Error("LRO started but no Location header was returned.");
      const retryAfter = Number(response.headers.get("Retry-After") ?? "2");
      return this.pollOperation(location, retryAfter, timeoutMs);
    }

    throw await httpError(response, "getDefinition");
  }

  private async pollOperation(
    operationUrl: string,
    retryAfterSeconds: number,
    timeoutMs: number,
  ): Promise<RawPart[]> {
    const deadline = Date.now() + timeoutMs;
    let delayMs = Math.max(1, retryAfterSeconds) * 1000;

    while (Date.now() < deadline) {
      await sleep(delayMs);
      const statusResp = await this.request("GET", operationUrl);
      if (!statusResp.ok) throw await httpError(statusResp, "operation status");

      const status = (await statusResp.json()) as { status?: string; error?: unknown };
      const state = (status.status ?? "").toLowerCase();

      if (state === "succeeded") {
        const resultResp = await this.request("GET", `${operationUrl}/result`);
        if (!resultResp.ok) throw await httpError(resultResp, "operation result");
        const body = (await resultResp.json()) as { definition?: { parts?: RawPart[] } };
        return body.definition?.parts ?? [];
      }
      if (state === "failed") {
        throw new Error(`getDefinition operation failed: ${JSON.stringify(status.error ?? status)}`);
      }
      const nextRetry = Number(statusResp.headers.get("Retry-After") ?? "0");
      if (nextRetry > 0) delayMs = nextRetry * 1000;
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for getDefinition to complete.`);
  }

  private async request(method: string, url: string): Promise<Response> {
    const token = await this.tokenPromise;
    return fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });
  }
}

function decodePart(part: RawPart): DefinitionPart {
  const content =
    part.payloadType === "InlineBase64"
      ? Buffer.from(part.payload, "base64").toString("utf-8")
      : part.payload;
  return { path: part.path, content };
}

async function httpError(response: Response, context: string): Promise<Error> {
  let detail = "";
  try {
    detail = await response.text();
  } catch {
    /* ignore */
  }
  return new Error(`Fabric ${context} failed: ${response.status} ${response.statusText}\n${detail}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
