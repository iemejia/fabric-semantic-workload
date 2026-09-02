# Embedding the analyzer in a Fabric workload

Milestone 1 built the analysis **engine**; Milestone 2 exposes it as a browser-safe
module (`src/index.ts`) and ships a React UI (`web/`). This guide explains how to drop
that engine into a real Microsoft Fabric workload built with the
[Fabric Extensibility Toolkit](https://github.com/microsoft/fabric-extensibility-toolkit).

> The toolkit is designed to be **forked and customized** (it ships a .NET DevGateway,
> PowerShell setup scripts, an Entra app, and a webpack React app under `Workload/`). Rather
> than rebuild that scaffolding here, we keep the engine standalone and reusable, and add a
> thin item on top of a toolkit fork.

## Why the engine is a good fit

- `src/index.ts` re-exports **only browser-safe** code — no `fs`, no `Buffer`, no
  `@azure/identity`. The same `analyze()` used by the CLI runs unchanged in the Fabric host.
- Inside Fabric, authentication and the REST call are handled by the **host SDK**
  (`@ms-fabric/workload-client`) and the toolkit's `ItemClient`, so you do **not** ship the
  Node `src/fabric/*` client into the workload.

## Steps

### 1. Fork the toolkit and vendor the engine

```bash
# in your fork of microsoft/fabric-extensibility-toolkit
mkdir -p Workload/app/engine
cp -r <this-repo>/src/model  Workload/app/engine/model
cp -r <this-repo>/src/analyzer Workload/app/engine/analyzer
cp -r <this-repo>/src/report  Workload/app/engine/report
cp <this-repo>/src/index.ts   Workload/app/engine/index.ts
```

(Or publish this repo's engine as a private npm package and `npm install` it — cleaner long
term. The engine has zero runtime dependencies.)

### 2. Create the item

Mirror the `HelloWorldItem` sample. You need three groups of files:

| Toolkit location | Purpose |
| --- | --- |
| `Workload/Manifest/items/SemanticModelAnalyzerItem/*.json` + `*.xml` | Item registration in the manifest |
| `Workload/Manifest/Product.json` | Add the item to the product so it shows in the hub |
| `Workload/app/items/SemanticModelAnalyzerItem/*` | The editor UI (React) |

Define the item's persisted definition (what your item stores in Fabric):

```ts
// Workload/app/items/SemanticModelAnalyzerItem/AnalyzerItemDefinition.ts
export interface AnalyzerItemDefinition {
  /** The workspace + semantic model the user chose to analyze. */
  targetWorkspaceId?: string;
  targetSemanticModelId?: string;
}
```

### 3. Fetch the model definition via the host, then analyze

The toolkit's `ItemClient` already wraps the Fabric `getDefinition` REST API and its
long-running-operation polling. Semantic models are items, so the generic
`getItemDefinitionWithPolling(workspaceId, itemId, "TMSL")` returns the same base64 parts our
loader expects.

```tsx
// Workload/app/items/SemanticModelAnalyzerItem/AnalyzerItemEditor.tsx
import { useState } from "react";
import { PageProps } from "../../App";
import { ItemClient } from "../../clients/ItemClient";
import { analyze, loadModelFromParts, type AnalysisResult, type DefinitionPart } from "../../engine";

// Browser-safe base64 decode (replaces Node's Buffer used by the CLI client).
function decodeParts(parts: { path: string; payload: string; payloadType: string }[]): DefinitionPart[] {
  return parts.map((p) => ({
    path: p.path,
    content: p.payloadType === "InlineBase64" ? new TextDecoder().decode(base64ToBytes(p.payload)) : p.payload,
  }));
}
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function AnalyzerItemEditor({ workloadClient }: PageProps) {
  const [result, setResult] = useState<AnalysisResult | null>(null);

  async function runAnalysis(workspaceId: string, semanticModelId: string) {
    const client = new ItemClient(workloadClient);
    const definition = await client.getItemDefinitionWithPolling(workspaceId, semanticModelId, "TMSL");
    const parts = decodeParts(definition.definition.parts);
    const model = loadModelFromParts(parts, semanticModelId);
    setResult(analyze(model));
  }

  // Render `result` with the same UI as web/App.tsx (badges, filters, recommendations).
  return /* … */ null;
}
```

Reuse the presentation from [`web/App.tsx`](../web/App.tsx) — the `FindingRow` component and
severity chips are host-agnostic and can be copied directly (swap plain elements for Fluent UI
`MessageBar`/`Badge` to match the Fabric Design System).

### 4. Register the editor route

Follow `HelloWorldItem/index.ts` to register the editor page and its route, then add the item
to `Product.json`. Start the DevServer + DevGateway per the toolkit README and the new item
appears in the Fabric workload hub.

## Scopes & permissions

`getItemDefinition` requires `Item.ReadWrite.All` (or `SemanticModel.ReadWrite.All`) and
read/write permission on the target model. Declare the scopes in the workload manifest; the
host acquires tokens — the workload never handles credentials directly.

## What stays in this repo

- The **engine** (`src/model`, `src/analyzer`, `src/report`, `src/index.ts`) — the source of
  truth for rules, reused by the CLI, the web UI, and the Fabric item.
- The **CLI + Node Fabric client** (`src/cli.ts`, `src/fabric/*`) — for local/CI analysis
  outside Fabric.
- The **web UI** (`web/`) — a standalone playground and the reference implementation of the
  item editor's presentation.
