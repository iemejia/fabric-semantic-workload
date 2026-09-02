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

- [ ] **Milestone 1 — Analyzer (standalone TS prototype)**
  - Fetch a semantic model definition via the Fabric REST API `getDefinition` (TMDL/TMSL).
  - Parse the model metadata into a normalized object graph.
  - Run a best-practices rule engine and emit suggestions (console / JSON / Markdown).
- [ ] **Milestone 2 — Wrap analyzer into a Fabric workload** (Extensibility Toolkit).
- [ ] **Milestone 3 — Share / import** semantic models.

## Status

Early scaffolding. See the roadmap above.
