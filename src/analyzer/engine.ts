import type { SemanticModel } from "../model/types.js";
import { RULES } from "./rules.js";
import type { AnalysisResult, Finding, Rule, Severity } from "./types.js";

const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warning: 1, info: 2 };

export interface AnalyzeOptions {
  /** Override the default rule set. */
  rules?: Rule[];
  /** Only include findings at or above this severity. */
  minSeverity?: Severity;
}

/** Run the best-practices rule engine over a normalized semantic model. */
export function analyze(model: SemanticModel, options: AnalyzeOptions = {}): AnalysisResult {
  const rules = options.rules ?? RULES;
  const findings: Finding[] = [];

  for (const rule of rules) {
    let raw;
    try {
      raw = rule.evaluate(model);
    } catch (err) {
      raw = [
        {
          severity: "info" as Severity,
          target: model.name,
          message: `Rule "${rule.id}" failed to evaluate: ${(err as Error).message}`,
          recommendation: "This is an analyzer error, not a model issue. Please report it.",
        },
      ];
    }
    for (const f of raw) {
      findings.push({
        ruleId: rule.id,
        title: rule.title,
        category: rule.category,
        docUrl: rule.docUrl,
        ...f,
      });
    }
  }

  const threshold = options.minSeverity ? SEVERITY_ORDER[options.minSeverity] : Infinity;
  const filtered = findings.filter((f) => SEVERITY_ORDER[f.severity] <= threshold);

  filtered.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId));

  const byCategory: Record<string, number> = {};
  for (const f of filtered) byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;

  return {
    modelName: model.name,
    sourceFormat: model.sourceFormat,
    findings: filtered,
    summary: {
      total: filtered.length,
      error: filtered.filter((f) => f.severity === "error").length,
      warning: filtered.filter((f) => f.severity === "warning").length,
      info: filtered.filter((f) => f.severity === "info").length,
      byCategory,
    },
    stats: {
      tables: model.tables.length,
      columns: model.tables.reduce((n, t) => n + t.columns.length, 0),
      measures: model.tables.reduce((n, t) => n + t.measures.length, 0),
      relationships: model.relationships.length,
    },
  };
}
