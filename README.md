# fabric-semantic-workload

A Microsoft Fabric workload experience (JavaScript/TypeScript) to **analyze and improve
semantic models**, and (later) to **share and import** them.

## Vision

- **Analyze** an existing Power BI / Fabric semantic model and suggest improvements based on
  [Semantic model best practices](https://learn.microsoft.com/en-us/fabric/data-science/semantic-model-best-practices).
- **Deliver** it as a native Fabric workload using the
  [Fabric Extensibility Toolkit](https://learn.microsoft.com/en-us/fabric/extensibility-toolkit/build-your-workload).
- **Share / import** semantic models (mechanism TBD — deferred).

## Roadmap

- [x] **Milestone 1 — Analyzer (standalone TS prototype)**
  - Fetch a semantic model definition via the Fabric REST API `getDefinition` (TMSL/TMDL).
  - Parse the model metadata into a normalized object graph.
  - Run a best-practices rule engine and emit suggestions (console / JSON / Markdown).
- [x] **Milestone 2 — Reusable engine + workload UI**
  - Browser-safe engine API (`src/index.ts`) with zero runtime dependencies.
  - React (Vite) UI that runs the analyzer entirely client-side (`web/`).
  - Integration guide to embed the engine in a Fabric Extensibility Toolkit item.
- [ ] **Milestone 3 — Share / import** semantic models.

## Milestone 1: the analyzer

A CLI that loads a semantic model definition, normalizes it, and runs a best-practices
rule engine against the guidance in the
[semantic model best practices](https://learn.microsoft.com/en-us/fabric/data-science/semantic-model-best-practices)
article.

### Install & build

```bash
npm install
npm run build      # compile TypeScript to dist/
npm test           # run the vitest suite
```

### Usage

Run directly from source with `tsx`, or use the compiled `dist/cli.js`:

```bash
# Analyze a local TMSL model.bim (no auth required — great for testing)
npm start -- analyze --file samples/contoso-bad.model.bim --name Contoso

# Analyze a local TMDL / PBIP definition folder
npm start -- analyze --folder ./MyModel.SemanticModel

# Analyze a live model in Fabric (requires auth — see below)
npm start -- analyze --workspace <workspaceId> --model <semanticModelId>

# Output formats and filtering
npm start -- analyze --file samples/contoso-bad.model.bim --output markdown --out report.md
npm start -- analyze --file samples/contoso-bad.model.bim --output json
npm start -- analyze --file samples/contoso-bad.model.bim --min-severity warning
npm start -- analyze --file samples/contoso-bad.model.bim --fail-on error   # CI gate
```

### Authentication (live models)

The Fabric client acquires a bearer token for `https://api.fabric.microsoft.com/.default`
in this order (see `.env.example`):

1. `FABRIC_TOKEN` env var / `--token` flag (a raw bearer token).
2. **Azure CLI** credential — run `az login` first.
3. **Device code** credential — set `FABRIC_CLIENT_ID` (+ optional `FABRIC_TENANT_ID`).

The caller needs `SemanticModel.ReadWrite.All` or `Item.ReadWrite.All` and read/write
permission on the model (a `getDefinition` requirement).

### What it checks

| Rule | Category | Detects |
| --- | --- | --- |
| `naming/non-descriptive` | naming | Cryptic names like `TR_AMT`, `DIM_GEO_01`, `F_SLS` |
| `metadata/missing-descriptions` | metadata | AI-visible tables/measures without descriptions |
| `metadata/visible-keys` | metadata | Surrogate/relationship key columns left visible |
| `measures/implicit-measures` | measures | Implicit measures enabled; numeric columns that aggregate |
| `measures/overlapping` | measures | Duplicate/overlapping measures (e.g. Total Sales vs Revenue) |
| `measures/helper-measures` | measures | Helper/intermediate measures to exclude from the AI schema |
| `measures/broken-references` | measures | DAX referencing measures/columns that don't exist |
| `dates/ambiguous` | dates | Multiple visible date columns in one table |
| `performance/auto-date-time` | performance | Auto date/time helper tables |
| `performance/calculated-columns` | performance | Calculated columns (size/refresh cost) |
| `modeling/relationships` | modeling | Bidirectional, many-to-many, inactive relationships |
| `modeling/snowflake` | modeling | Snowflaked dimensions that should be flattened |
| `modeling/wide-tables` | modeling | Wide/flat (denormalized) tables |
| `ai-readiness/prep-for-ai` | ai-readiness | Missing AI instructions / verified answers / Q&A |

### Architecture

```
src/
├── fabric/     REST getDefinition client + Entra auth
├── model/      normalized model types + TMSL & TMDL loaders + AI-artifact loader
├── analyzer/   rule engine + best-practice rules
├── report/     console / markdown renderers (JSON is built-in)
└── cli.ts      command-line entry point
```

The rule engine operates on a **format-agnostic normalized model**, so the same rules run
whether the definition came from TMSL (`model.bim` JSON), TMDL (`definition/*.tmdl`), a live
Fabric workspace, or a local folder. This engine is designed to be reused inside the Fabric
workload UI in Milestone 2.

## Milestone 2: reusable engine + workload UI

The analysis engine is exposed as a **browser-safe module** (`src/index.ts`) with zero runtime
dependencies — the same `analyze()` runs in Node (CLI), the browser (web UI), and a Fabric
workload item.

### Web UI (playground)

A React + Vite app that runs the analyzer entirely in the browser — upload or paste a
`model.bim`, or load the bundled sample, and explore findings interactively.

**Live demo:** https://ismaelmejia.com/fabric-semantic-workload/ (auto-deployed to GitHub
Pages from `main` via `.github/workflows/pages.yml`).

```bash
npm run web:dev       # start the dev server (http://localhost:5173)
npm run web:build     # production build to dist-web/
# For the GitHub Pages base path:
PAGES_BASE=/fabric-semantic-workload/ npm run web:build
```

This static, backend-free build is exactly what a Fabric **FERemote** workload embeds: point
the manifest's `FRONTEND_URL` at a static host (GitHub Pages, Azure Static Web Apps, …) and
Fabric loads it in an iframe. See
[docs/fabric-workload-integration.md](docs/fabric-workload-integration.md).

### Embedding in a Fabric workload

See [docs/fabric-workload-integration.md](docs/fabric-workload-integration.md) for a step-by-step
guide that maps the engine onto the
[Fabric Extensibility Toolkit](https://github.com/microsoft/fabric-extensibility-toolkit) item
pattern (fetching the model via the toolkit's `ItemClient.getItemDefinitionWithPolling`, then
feeding the parts to `loadModelFromParts` + `analyze`).

### Layout

```
src/         engine + Node CLI (see architecture above)
web/         React (Vite) workload UI reusing the engine
docs/        Fabric workload integration guide
samples/     example semantic model definitions
```
