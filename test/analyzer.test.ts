import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyzer/engine.js";
import { extractDependencies } from "../src/analyzer/dax.js";
import { isCrypticName } from "../src/analyzer/rules.js";
import { loadModelFromParts } from "../src/model/load.js";
import type { SemanticModel } from "../src/model/types.js";

function sample(): string {
  const p = fileURLToPath(new URL("../samples/contoso-bad.model.bim", import.meta.url));
  return readFileSync(p, "utf-8");
}

describe("isCrypticName", () => {
  it("flags warehouse-style and abbreviated names", () => {
    expect(isCrypticName("TR_AMT")).toBe(true);
    expect(isCrypticName("DIM_GEO_01")).toBe(true);
    expect(isCrypticName("F_SLS")).toBe(true);
    expect(isCrypticName("SLS_QTY")).toBe(true);
  });

  it("does not flag business-friendly names", () => {
    expect(isCrypticName("Total Revenue")).toBe(false);
    expect(isCrypticName("Product Name")).toBe(false);
    expect(isCrypticName("Sales")).toBe(false);
  });
});

describe("TMSL loader", () => {
  it("normalizes tables, columns, measures and relationships", () => {
    const model = loadModelFromParts([{ path: "model.bim", content: sample() }], "Contoso");
    expect(model.sourceFormat).toBe("TMSL");
    expect(model.tables).toHaveLength(5);
    const fact = model.tables.find((t) => t.name === "F_SLS")!;
    expect(fact.columns.length).toBeGreaterThan(0);
    expect(fact.measures.map((m) => m.name)).toContain("Total Sales");
    expect(model.relationships).toHaveLength(5);
    expect(model.tables.some((t) => t.isAutoDateTable)).toBe(true);
  });
});

describe("analyze", () => {
  const model = loadModelFromParts([{ path: "model.bim", content: sample() }], "Contoso");
  const result = analyze(model);

  it("detects the seeded best-practice violations", () => {
    const rules = new Set(result.findings.map((f) => f.ruleId));
    expect(rules).toContain("naming/non-descriptive");
    expect(rules).toContain("measures/overlapping");
    expect(rules).toContain("measures/implicit-measures");
    expect(rules).toContain("dates/ambiguous");
    expect(rules).toContain("performance/auto-date-time");
    expect(rules).toContain("modeling/relationships");
    expect(rules).toContain("modeling/snowflake");
    expect(rules).toContain("performance/calculated-columns");
    expect(rules).toContain("metadata/visible-keys");
    expect(rules).toContain("measures/helper-measures");
    expect(rules).toContain("metadata/measure-format-string");
    expect(rules).toContain("modeling/unused-columns");
    expect(rules).toContain("dates/date-table");
    expect(rules).toContain("modeling/relationship-integrity");
    expect(rules).toContain("naming/ambiguity");
    expect(rules).toContain("ai-readiness/description-coverage");
    expect(rules).toContain("ai-readiness/prep-for-ai");
  });

  it("produces a consistent summary", () => {
    expect(result.summary.total).toBe(result.findings.length);
    expect(result.summary.error + result.summary.warning + result.summary.info).toBe(
      result.summary.total,
    );
  });

  it("respects the minSeverity filter", () => {
    const warnOnly = analyze(model, { minSeverity: "warning" });
    expect(warnOnly.findings.every((f) => f.severity !== "info")).toBe(true);
  });
});

describe("extractDependencies", () => {
  it("separates measure and column references", () => {
    const deps = extractDependencies("CALCULATE([Total Sales], Sales[Region] = \"West\") + [Tax]");
    expect(deps.measures).toContain("Total Sales");
    expect(deps.measures).toContain("Tax");
    expect(deps.columns).toContainEqual({ table: "Sales", column: "Region" });
  });

  it("handles quoted table names and ignores string literals", () => {
    const deps = extractDependencies("SUMX('Order Lines', 'Order Lines'[Qty]) // [NotAMeasure]");
    expect(deps.columns).toContainEqual({ table: "Order Lines", column: "Qty" });
    expect(deps.measures).toHaveLength(0);
  });
});

describe("broken references", () => {
  it("flags references to non-existent measures and columns", () => {
    const brokenModel: SemanticModel = {
      name: "Broken",
      tables: [
        {
          name: "Sales",
          isHidden: false,
          isAutoDateTable: false,
          isDateTable: false,
          columns: [
            { name: "Amount", dataType: "double", isHidden: false, isKey: false, isCalculated: false },
          ],
          measures: [
            { name: "Bad Measure", expression: "[Missing Measure] + Sales[Ghost Column]", isHidden: false },
          ],
          partitions: [],
        },
      ],
      relationships: [],
      ai: { hasVerifiedAnswers: false },
      sourceFormat: "TMSL",
    };
    const res = analyze(brokenModel);
    const broken = res.findings.filter((f) => f.ruleId === "measures/broken-references");
    expect(broken.length).toBe(2);
    expect(res.summary.error).toBeGreaterThanOrEqual(2);
  });
});
