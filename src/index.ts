/**
 * Public, browser-safe API for the semantic model analyzer engine.
 *
 * This barrel intentionally exposes only the pieces that have **no Node.js
 * dependencies** (no fs, no Buffer, no @azure/identity), so it can be embedded
 * directly in a browser UI — including a Fabric workload item editor — as well
 * as in the Node CLI.
 *
 * The Fabric REST client (`src/fabric/*`) and the CLI (`src/cli.ts`) are Node
 * only and are deliberately NOT re-exported here.
 */

// Normalized model + loaders
export type {
  SemanticModel,
  Table,
  Column,
  Measure,
  Partition,
  Relationship,
  AiReadiness,
} from "./model/types.js";
export { loadModelFromParts, type DefinitionPart } from "./model/load.js";
export { loadFromTmsl } from "./model/tmsl.js";
export { loadFromTmdl, type TmdlFile } from "./model/tmdl.js";

// Analyzer
export { analyze, type AnalyzeOptions } from "./analyzer/engine.js";
export { RULES } from "./analyzer/rules.js";
export { extractDependencies, type DaxDependencies } from "./analyzer/dax.js";
export type {
  AnalysisResult,
  Finding,
  Rule,
  Severity,
  Category,
} from "./analyzer/types.js";

// Reports
export { renderMarkdown } from "./report/markdown.js";
export { renderConsole } from "./report/console.js";
