import type { SemanticModel } from "../model/types.js";

export type Severity = "error" | "warning" | "info";

export type Category =
  | "naming"
  | "metadata"
  | "modeling"
  | "performance"
  | "measures"
  | "dates"
  | "ai-readiness";

/** A single issue or recommendation produced by a rule. */
export interface Finding {
  ruleId: string;
  title: string;
  severity: Severity;
  category: Category;
  /** Dotted object path this finding applies to, e.g. "Sales[Total Sales]". */
  target?: string;
  message: string;
  recommendation: string;
  docUrl?: string;
}

export interface Rule {
  id: string;
  title: string;
  category: Category;
  defaultSeverity: Severity;
  /** Reference to the best-practice guidance this rule enforces. */
  docUrl?: string;
  evaluate(model: SemanticModel): Omit<Finding, "ruleId" | "title" | "category" | "docUrl">[];
}

export interface AnalysisResult {
  modelName: string;
  sourceFormat: SemanticModel["sourceFormat"];
  findings: Finding[];
  summary: {
    total: number;
    error: number;
    warning: number;
    info: number;
    byCategory: Record<string, number>;
  };
  stats: {
    tables: number;
    columns: number;
    measures: number;
    relationships: number;
  };
}
