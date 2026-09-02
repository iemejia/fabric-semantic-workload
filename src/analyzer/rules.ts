import {
  type SemanticModel,
  type Table,
  isDateType,
  isNumericType,
} from "../model/types.js";
import { extractDependencies } from "./dax.js";
import type { Finding, Rule } from "./types.js";

type RuleFinding = Omit<Finding, "ruleId" | "title" | "category" | "docUrl">;

const DOC_BEST_PRACTICES =
  "https://learn.microsoft.com/en-us/fabric/data-science/semantic-model-best-practices";
const DOC_PREP_AI = "https://learn.microsoft.com/en-us/power-bi/create-reports/copilot-prepare-data-ai";
const DOC_OPTIMIZE =
  "https://learn.microsoft.com/en-us/training/modules/optimize-model-power-bi/";

/** Convenience: object path used in findings. */
const col = (t: string, c: string) => `${t}[${c}]`;
const measure = (t: string, m: string) => `${t}[${m}]`;

// ---------------------------------------------------------------------------
// Rule: non-descriptive naming
// ---------------------------------------------------------------------------
const CRYPTIC_PREFIX = /^(dim|fact|f|d|t|tbl|vw)[_-]/i;

function isCrypticName(name: string): boolean {
  const n = name.trim();
  if (n.length === 0) return false;
  // ALL_CAPS_WITH_UNDERSCORES, e.g. TR_AMT, DIM_GEO_01, F_SLS
  if (/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(n)) return true;
  // Known warehouse-style prefixes
  if (CRYPTIC_PREFIX.test(n)) return true;
  // Short, vowel-less tokens that read like abbreviations (AMT, QTY, SLS)
  const compact = n.replace(/[^A-Za-z]/g, "");
  if (compact.length >= 3 && compact.length <= 6 && !/[aeiou]/i.test(compact)) return true;
  return false;
}

const nonDescriptiveNaming: Rule = {
  id: "naming/non-descriptive",
  title: "Non-descriptive object names",
  category: "naming",
  defaultSeverity: "warning",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    const check = (
      name: string,
      target: string,
      hasDescription: boolean,
      kind: string,
    ) => {
      if (!isCrypticName(name)) return;
      const mitigated = hasDescription;
      findings.push({
        severity: mitigated ? "info" : "warning",
        target,
        message: `The ${kind} name "${name}" is cryptic and provides little context for the DAX generation tool.`,
        recommendation: mitigated
          ? `Consider renaming to a business-friendly name. A description exists, which partially mitigates this.`
          : `Rename to a clear, business-friendly name (e.g. "Total Revenue" instead of "TR_AMT"). If you cannot rename, add a description and synonyms.`,
      });
    };

    for (const t of model.tables) {
      if (t.isAutoDateTable) continue;
      check(t.name, t.name, !!t.description, "table");
      for (const c of t.columns) {
        if (c.isHidden) continue;
        check(c.name, col(t.name, c.name), !!c.description, "column");
      }
      for (const m of t.measures) {
        if (m.isHidden) continue;
        check(m.name, measure(t.name, m.name), !!m.description, "measure");
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: missing descriptions (helps the LLM understand each object)
// ---------------------------------------------------------------------------
const missingDescriptions: Rule = {
  id: "metadata/missing-descriptions",
  title: "Missing descriptions on AI-visible objects",
  category: "metadata",
  defaultSeverity: "info",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    for (const t of model.tables) {
      if (t.isAutoDateTable || t.isHidden) continue;
      if (!t.description) {
        findings.push({
          severity: "info",
          target: t.name,
          message: `Table "${t.name}" has no description.`,
          recommendation:
            "Add a description so the LLM understands the table's purpose when it is part of the AI data schema.",
        });
      }
      for (const m of t.measures) {
        if (m.isHidden || m.description) continue;
        findings.push({
          severity: "info",
          target: measure(t.name, m.name),
          message: `Measure "${m.name}" has no description.`,
          recommendation:
            "Add a description explaining the business meaning of the measure to improve DAX generation accuracy.",
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: implicit measures
// ---------------------------------------------------------------------------
const implicitMeasures: Rule = {
  id: "measures/implicit-measures",
  title: "Implicit measures are enabled",
  category: "measures",
  defaultSeverity: "warning",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const findings: RuleFinding[] = [];

    if (model.discourageImplicitMeasures !== true) {
      findings.push({
        severity: "warning",
        target: model.name,
        message:
          "The model does not discourage implicit measures. Implicit measures can lead to unpredictable aggregation results.",
        recommendation:
          "Create explicit DAX measures for values users should query and enable 'Discourage implicit measures'. Set the correct default summarization on numeric columns.",
      });
    }

    for (const t of model.tables) {
      if (t.isAutoDateTable) continue;
      for (const c of t.columns) {
        if (c.isHidden || !isNumericType(c.dataType)) continue;
        const summarize = (c.summarizeBy ?? "default").toLowerCase();
        if (summarize !== "none") {
          findings.push({
            severity: "info",
            target: col(t.name, c.name),
            message: `Numeric column "${c.name}" has summarization "${summarize}", exposing an implicit measure.`,
            recommendation:
              "Set summarizeBy to 'none' and create an explicit measure, unless this column is intentionally aggregatable.",
          });
        }
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: duplicate / overlapping measures
// ---------------------------------------------------------------------------
const MEASURE_STOPWORDS = new Set([
  "total",
  "sum",
  "of",
  "the",
  "amount",
  "amt",
  "value",
  "all",
  "count",
  "avg",
  "average",
]);
const SYNONYM_CANON: Record<string, string> = {
  revenue: "sales",
  turnover: "sales",
  sales: "sales",
  income: "profit",
  earnings: "profit",
  profit: "profit",
  cost: "cost",
  spend: "cost",
  expense: "cost",
};

function measureTokens(name: string): Set<string> {
  const tokens = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !MEASURE_STOPWORDS.has(w))
    .map((w) => SYNONYM_CANON[w] ?? w);
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const duplicateMeasures: Rule = {
  id: "measures/overlapping",
  title: "Duplicate or overlapping measures",
  category: "measures",
  defaultSeverity: "warning",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    const visible: { path: string; name: string; tokens: Set<string> }[] = [];
    for (const t of model.tables) {
      for (const m of t.measures) {
        if (m.isHidden) continue;
        visible.push({ path: measure(t.name, m.name), name: m.name, tokens: measureTokens(m.name) });
      }
    }
    const reported = new Set<string>();
    for (let i = 0; i < visible.length; i++) {
      for (let j = i + 1; j < visible.length; j++) {
        const a = visible[i];
        const b = visible[j];
        const sim = jaccard(a.tokens, b.tokens);
        if (sim >= 0.5) {
          const key = `${a.path}::${b.path}`;
          if (reported.has(key)) continue;
          reported.add(key);
          findings.push({
            severity: "warning",
            target: a.path,
            message: `Measure "${a.name}" overlaps with "${b.name}" and may create ambiguity for the AI.`,
            recommendation:
              "Consolidate or clearly differentiate these measures, and exclude duplicates from the AI data schema.",
          });
        }
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: ambiguous date fields
// ---------------------------------------------------------------------------
const ambiguousDateFields: Rule = {
  id: "dates/ambiguous",
  title: "Ambiguous date fields",
  category: "dates",
  defaultSeverity: "warning",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    for (const t of model.tables) {
      if (t.isAutoDateTable || t.isDateTable) continue;
      const dateCols = t.columns.filter((c) => !c.isHidden && isDateType(c.dataType));
      if (dateCols.length > 1) {
        findings.push({
          severity: "warning",
          target: t.name,
          message: `Table "${t.name}" exposes multiple date columns (${dateCols
            .map((c) => c.name)
            .join(", ")}), which can confuse the AI.`,
          recommendation:
            "Use AI instructions and verified answers in Prep for AI to specify which date field to use by default.",
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: auto date/time tables
// ---------------------------------------------------------------------------
const autoDateTime: Rule = {
  id: "performance/auto-date-time",
  title: "Auto date/time tables present",
  category: "performance",
  defaultSeverity: "warning",
  docUrl: DOC_OPTIMIZE,
  evaluate(model) {
    const auto = model.tables.filter((t) => t.isAutoDateTable);
    if (auto.length === 0) return [];
    return [
      {
        severity: "warning",
        target: model.name,
        message: `Found ${auto.length} auto date/time helper table(s). These bloat the model and add noise for the DAX generation tool.`,
        recommendation:
          "Disable auto date/time and use a single, well-modeled date dimension marked as a date table.",
      },
    ];
  },
};

// ---------------------------------------------------------------------------
// Relationship rules (star schema hygiene)
// ---------------------------------------------------------------------------
const relationshipHygiene: Rule = {
  id: "modeling/relationships",
  title: "Relationship design issues",
  category: "modeling",
  defaultSeverity: "warning",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    for (const r of model.relationships) {
      const label = `${r.fromTable}[${r.fromColumn}] -> ${r.toTable}[${r.toColumn}]`;
      if (r.crossFilteringBehavior === "bothDirections") {
        findings.push({
          severity: "warning",
          target: label,
          message: `Bidirectional cross-filter on relationship ${label} can cause ambiguity and slow queries.`,
          recommendation:
            "Prefer single-direction relationships in a star schema; use bidirectional filtering only when strictly required.",
        });
      }
      if (r.fromCardinality === "many" && r.toCardinality === "many") {
        findings.push({
          severity: "warning",
          target: label,
          message: `Many-to-many relationship ${label} makes DAX harder to generate correctly.`,
          recommendation:
            "Introduce a bridge/dimension table to resolve the many-to-many into a star schema.",
        });
      }
      if (!r.isActive) {
        findings.push({
          severity: "info",
          target: label,
          message: `Inactive relationship ${label} requires USERELATIONSHIP and can confuse the AI.`,
          recommendation:
            "Document the intended usage via AI instructions, or reconsider whether the inactive relationship is needed.",
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: wide / flat tables (denormalization hint)
// ---------------------------------------------------------------------------
const WIDE_TABLE_COLUMN_THRESHOLD = 30;
const wideTables: Rule = {
  id: "modeling/wide-tables",
  title: "Wide, possibly denormalized tables",
  category: "modeling",
  defaultSeverity: "info",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    for (const t of model.tables as Table[]) {
      if (t.isAutoDateTable || t.isHidden) continue;
      if (t.columns.length > WIDE_TABLE_COLUMN_THRESHOLD) {
        findings.push({
          severity: "info",
          target: t.name,
          message: `Table "${t.name}" has ${t.columns.length} columns, suggesting a flat/denormalized design.`,
          recommendation:
            "DAX is optimized for star schemas. Unpivot wide tables into normalized fact and dimension tables.",
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: Prep-for-AI readiness
// ---------------------------------------------------------------------------
const prepForAi: Rule = {
  id: "ai-readiness/prep-for-ai",
  title: "Prep for AI configuration",
  category: "ai-readiness",
  defaultSeverity: "info",
  docUrl: DOC_PREP_AI,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    if (!model.ai.instructions) {
      findings.push({
        severity: "info",
        target: model.name,
        message: "No AI instructions found in Prep for AI.",
        recommendation:
          "Add AI instructions (business terminology, metric preferences, default groupings) in Prep for AI, not at the data agent level.",
      });
    }
    if (!model.ai.hasVerifiedAnswers) {
      findings.push({
        severity: "info",
        target: model.name,
        message: "No verified answers found.",
        recommendation:
          "Create verified answers for your most common questions with 5-7 trigger phrases each to improve response consistency.",
      });
    }
    if (model.ai.qnaEnabled === false) {
      findings.push({
        severity: "info",
        target: model.name,
        message: "Q&A is disabled, which prevents instance value indexing for advanced DAX generation.",
        recommendation:
          "Enable the model's Q&A setting to support instance value indexing (advanced DAX generation).",
      });
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: calculated columns (performance / freshness)
// ---------------------------------------------------------------------------
const calculatedColumns: Rule = {
  id: "performance/calculated-columns",
  title: "Calculated columns",
  category: "performance",
  defaultSeverity: "info",
  docUrl: DOC_OPTIMIZE,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    for (const t of model.tables) {
      if (t.isAutoDateTable) continue;
      for (const c of t.columns) {
        if (!c.isCalculated) continue;
        findings.push({
          severity: "info",
          target: col(t.name, c.name),
          message: `Column "${c.name}" is a calculated column, which increases model size and refresh cost.`,
          recommendation:
            "Where possible, push the calculation to the source (Power Query / the data source) or use a measure instead.",
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: snowflake dimensions (star-schema hygiene)
// ---------------------------------------------------------------------------
const snowflakeDimensions: Rule = {
  id: "modeling/snowflake",
  title: "Snowflaked dimensions",
  category: "modeling",
  defaultSeverity: "info",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    // A snowflake intermediate is a table that is on the "one" side of one
    // relationship (a dimension) yet also filters into another table (acts as
    // the "many" side pointing to a further dimension).
    const asToTable = new Set<string>();
    const asFromTable = new Set<string>();
    for (const r of model.relationships) {
      asToTable.add(r.toTable);
      asFromTable.add(r.fromTable);
    }
    const findings: RuleFinding[] = [];
    for (const t of model.tables) {
      if (t.isAutoDateTable) continue;
      const hasMeasures = t.measures.length > 0;
      // Facts typically carry measures and are only ever a "from" table.
      if (asToTable.has(t.name) && asFromTable.has(t.name) && !hasMeasures) {
        findings.push({
          severity: "info",
          target: t.name,
          message: `Table "${t.name}" appears to be a snowflaked dimension (it both receives and propagates filters).`,
          recommendation:
            "Flatten snowflaked dimensions into a single dimension table to keep a clean star schema for DAX.",
        });
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: visible key columns
// ---------------------------------------------------------------------------
const visibleKeys: Rule = {
  id: "metadata/visible-keys",
  title: "Visible key columns",
  category: "metadata",
  defaultSeverity: "info",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    for (const t of model.tables) {
      if (t.isAutoDateTable) continue;
      for (const c of t.columns) {
        if (c.isKey && !c.isHidden) {
          findings.push({
            severity: "info",
            target: col(t.name, c.name),
            message: `Key column "${c.name}" is visible, adding noise and inviting incorrect aggregations.`,
            recommendation:
              "Hide surrogate/relationship key columns and exclude them from the AI data schema.",
          });
        }
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: helper / intermediate measures
// ---------------------------------------------------------------------------
const helperMeasures: Rule = {
  id: "measures/helper-measures",
  title: "Helper / intermediate measures",
  category: "measures",
  defaultSeverity: "info",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const findings: RuleFinding[] = [];
    for (const t of model.tables) {
      for (const m of t.measures) {
        const looksHelper =
          m.isHidden || m.name.startsWith("_") || (m.displayFolder ?? "").startsWith("_");
        if (looksHelper) {
          findings.push({
            severity: "info",
            target: measure(t.name, m.name),
            message: `Measure "${m.name}" looks like a helper/intermediate measure.`,
            recommendation:
              "Exclude helper measures from the AI data schema so only real business metrics remain.",
          });
        }
      }
    }
    return findings;
  },
};

// ---------------------------------------------------------------------------
// Rule: broken DAX references
// ---------------------------------------------------------------------------
const brokenReferences: Rule = {
  id: "measures/broken-references",
  title: "Broken DAX references",
  category: "measures",
  defaultSeverity: "error",
  docUrl: DOC_BEST_PRACTICES,
  evaluate(model) {
    const measureNames = new Set<string>();
    const columnKeys = new Set<string>();
    const tableNames = new Set<string>();
    for (const t of model.tables) {
      tableNames.add(t.name.toLowerCase());
      for (const m of t.measures) measureNames.add(m.name.toLowerCase());
      for (const c of t.columns) columnKeys.add(`${t.name.toLowerCase()}|${c.name.toLowerCase()}`);
    }

    const findings: RuleFinding[] = [];
    for (const t of model.tables) {
      for (const m of t.measures) {
        const deps = extractDependencies(m.expression);
        for (const ref of deps.measures) {
          if (!measureNames.has(ref.toLowerCase())) {
            findings.push({
              severity: "error",
              target: measure(t.name, m.name),
              message: `Measure "${m.name}" references measure [${ref}], which does not exist in the model.`,
              recommendation: "Fix or remove the broken reference; broken measures break dependent AI responses.",
            });
          }
        }
        for (const ref of deps.columns) {
          // Only flag when we recognize the table but not the column (avoids
          // false positives from table variables / unresolved lexical matches).
          if (
            tableNames.has(ref.table.toLowerCase()) &&
            !columnKeys.has(`${ref.table.toLowerCase()}|${ref.column.toLowerCase()}`)
          ) {
            findings.push({
              severity: "error",
              target: measure(t.name, m.name),
              message: `Measure "${m.name}" references column ${ref.table}[${ref.column}], which does not exist.`,
              recommendation: "Fix or remove the broken column reference.",
            });
          }
        }
      }
    }
    return findings;
  },
};

/** All built-in rules, evaluated in order. */
export const RULES: Rule[] = [
  nonDescriptiveNaming,
  missingDescriptions,
  implicitMeasures,
  duplicateMeasures,
  ambiguousDateFields,
  autoDateTime,
  relationshipHygiene,
  snowflakeDimensions,
  wideTables,
  calculatedColumns,
  visibleKeys,
  helperMeasures,
  brokenReferences,
  prepForAi,
];

export { isCrypticName };
