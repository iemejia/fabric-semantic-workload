import {
  AzureCliCredential,
  ChainedTokenCredential,
  DeviceCodeCredential,
  type TokenCredential,
} from "@azure/identity";

/** OAuth scope for the Fabric REST API. */
export const FABRIC_SCOPE = "https://api.fabric.microsoft.com/.default";

export interface AuthOptions {
  /** Raw bearer token override (skips credential resolution). */
  token?: string;
  clientId?: string;
  tenantId?: string;
}

/**
 * Acquire a bearer token for the Fabric REST API.
 *
 * Resolution order:
 *   1. Explicit token / FABRIC_TOKEN env var.
 *   2. Azure CLI credential (`az login`).
 *   3. Device code credential (requires a client id).
 */
export async function getAccessToken(options: AuthOptions = {}): Promise<string> {
  const rawToken = options.token ?? process.env.FABRIC_TOKEN;
  if (rawToken && rawToken.trim()) {
    return rawToken.trim();
  }

  const credentials: TokenCredential[] = [new AzureCliCredential()];

  const clientId = options.clientId ?? process.env.FABRIC_CLIENT_ID;
  const tenantId = options.tenantId ?? process.env.FABRIC_TENANT_ID;
  if (clientId) {
    credentials.push(
      new DeviceCodeCredential({
        clientId,
        tenantId,
        userPromptCallback: (info) => {
          console.error(`\n${info.message}\n`);
        },
      }),
    );
  }

  const credential = new ChainedTokenCredential(...credentials);
  const token = await credential.getToken(FABRIC_SCOPE);
  if (!token) {
    throw new Error(
      "Could not acquire a Fabric access token. Run `az login`, set FABRIC_TOKEN, or provide FABRIC_CLIENT_ID for device-code login.",
    );
  }
  return token.token;
}
