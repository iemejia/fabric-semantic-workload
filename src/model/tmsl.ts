import {
  type Column,
  type Measure,
  type Partition,
  type Relationship,
  type SemanticModel,
  type Table,
  isAutoDateTableName,
} from "./types.js";

/**
 * Load a normalized {@link SemanticModel} from a TMSL `model.bim` document.
 *
 * TMSL is plain JSON, so this loader is intentionally the most robust path and
 * is the default requested from the Fabric REST API.
 */
export function loadFromTmsl(bim: unknown, modelName: string): SemanticModel {
  const root = asRecord(bim);
  const model = asRecord(root.model);

  const tables = asArray(model.tables).map(loadTable);

  return {
    name: modelName,
    culture: str(model.culture),
    discourageImplicitMeasures: bool(model.discourageImplicitMeasures),
    compatibilityLevel: num(root.compatibilityLevel),
    tables,
    relationships: asArray(model.relationships).map(loadRelationship),
    ai: { hasVerifiedAnswers: false },
    sourceFormat: "TMSL",
  };
}

function loadTable(raw: unknown): Table {
  const t = asRecord(raw);
  const name = str(t.name) ?? "(unnamed table)";
  const dataCategory = str(t.dataCategory);
  return {
    name,
    description: joinText(t.description),
    isHidden: bool(t.isHidden) ?? false,
    dataCategory,
    columns: asArray(t.columns).map(loadColumn),
    measures: asArray(t.measures).map(loadMeasure),
    partitions: asArray(t.partitions).map(loadPartition),
    isAutoDateTable: isAutoDateTableName(name),
    isDateTable:
      (dataCategory?.toLowerCase() === "time") ||
      asArray(t.columns).some((c) => str(asRecord(c).dataCategory)?.toLowerCase() === "time"),
  };
}

function loadColumn(raw: unknown): Column {
  const c = asRecord(raw);
  const type = str(c.type)?.toLowerCase();
  const isCalculated = type === "calculated" || type === "calculatedtablecolumn";
  return {
    name: str(c.name) ?? "(unnamed column)",
    dataType: str(c.dataType),
    description: joinText(c.description),
    isHidden: bool(c.isHidden) ?? false,
    isKey: bool(c.isKey) ?? false,
    summarizeBy: str(c.summarizeBy),
    dataCategory: str(c.dataCategory),
    sortByColumn: str(c.sortByColumn),
    sourceColumn: str(c.sourceColumn),
    formatString: str(c.formatString),
    isCalculated,
    expression: joinText(c.expression),
  };
}

function loadMeasure(raw: unknown): Measure {
  const m = asRecord(raw);
  return {
    name: str(m.name) ?? "(unnamed measure)",
    expression: joinText(m.expression),
    description: joinText(m.description),
    isHidden: bool(m.isHidden) ?? false,
    formatString: str(m.formatString),
    displayFolder: str(m.displayFolder),
  };
}

function loadPartition(raw: unknown): Partition {
  const p = asRecord(raw);
  const source = asRecord(p.source);
  return {
    name: str(p.name) ?? "(unnamed partition)",
    mode: str(p.mode),
    sourceType: str(source.type),
  };
}

function loadRelationship(raw: unknown): Relationship {
  const r = asRecord(raw);
  return {
    name: str(r.name),
    fromTable: str(r.fromTable) ?? "",
    fromColumn: str(r.fromColumn) ?? "",
    toTable: str(r.toTable) ?? "",
    toColumn: str(r.toColumn) ?? "",
    // TMSL default cross filter is single direction unless stated otherwise.
    crossFilteringBehavior: str(r.crossFilteringBehavior) ?? "oneDirection",
    isActive: bool(r.isActive) ?? true,
    // TMSL omits cardinality when it is the default "many" (from) / "one" (to).
    fromCardinality: str(r.fromCardinality) ?? "many",
    toCardinality: str(r.toCardinality) ?? "one",
  };
}

// --- small, defensive JSON helpers -----------------------------------------

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

/** TMSL allows multi-line string properties to be expressed as string arrays. */
function joinText(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").join("\n");
  return undefined;
}
