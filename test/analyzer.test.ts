import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { analyze } from "../src/analyzer/engine.js";
import { isCrypticName } from "../src/analyzer/rules.js";
import { loadModelFromParts } from "../src/model/load.js";

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
