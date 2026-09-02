/**
 * Normalized, format-agnostic representation of a tabular semantic model.
 *
 * Both the TMSL (model.bim JSON) and TMDL (definition/*.tmdl) loaders produce
 * this shape so the rule engine never has to care which format the model came in.
 */

export type SummarizeBy =
  | "default"
  | "none"
  | "sum"
  | "min"
  | "max"
  | "count"
  | "average"
  | "distinctCount"
  | string;

export type CrossFilteringBehavior = "oneDirection" | "bothDirections" | string;
export type Cardinality = "one" | "many" | string;

export interface Column {
  name: string;
  dataType?: string; // string, int64, double, decimal, dateTime, boolean, ...
  description?: string;
  isHidden: boolean;
  isKey: boolean;
  summarizeBy?: SummarizeBy;
  dataCategory?: string;
  sortByColumn?: string;
  sourceColumn?: string;
  formatString?: string;
  /** Calculated column (has a DAX expression rather than a source column). */
  isCalculated: boolean;
  expression?: string;
}

export interface Measure {
  name: string;
  expression?: string;
  description?: string;
  isHidden: boolean;
  formatString?: string;
  displayFolder?: string;
}

export interface Partition {
  name: string;
  /** import | directQuery | directLake | dual | ... */
  mode?: string;
  /** m | calculated | entity | ... */
  sourceType?: string;
}

export interface Table {
  name: string;
  description?: string;
  isHidden: boolean;
  dataCategory?: string;
  columns: Column[];
  measures: Measure[];
  partitions: Partition[];
  /** True when this is an auto date/time helper table (LocalDateTable_* / DateTableTemplate_*). */
  isAutoDateTable: boolean;
  /** True when the table is flagged as a date/time table (dataCategory Time or marked date table). */
  isDateTable: boolean;
}

export interface Relationship {
  name?: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  crossFilteringBehavior: CrossFilteringBehavior;
  isActive: boolean;
  fromCardinality: Cardinality;
  toCardinality: Cardinality;
}

/** Prep-for-AI / Copilot artifacts that ship alongside the model definition. */
export interface AiReadiness {
  /** Contents of Copilot/Instructions/instructions.md, if present. */
  instructions?: string;
  /** True when at least one verified answer is defined. */
  hasVerifiedAnswers: boolean;
  /** From definition.pbism settings.qnaEnabled. */
  qnaEnabled?: boolean;
}

export interface SemanticModel {
  name: string;
  culture?: string;
  /** When true, implicit measures are discouraged (recommended). */
  discourageImplicitMeasures?: boolean;
  compatibilityLevel?: number;
  tables: Table[];
  relationships: Relationship[];
  ai: AiReadiness;
  /** Which public-definition format the model was loaded from. */
  sourceFormat: "TMSL" | "TMDL";
}

const NUMERIC_TYPES = new Set(["int64", "double", "decimal", "currency", "money"]);
const DATE_TYPES = new Set(["datetime", "date"]);

export function isNumericType(dataType?: string): boolean {
  return !!dataType && NUMERIC_TYPES.has(dataType.toLowerCase());
}

export function isDateType(dataType?: string): boolean {
  return !!dataType && DATE_TYPES.has(dataType.toLowerCase());
}

export function isAutoDateTableName(name: string): boolean {
  return /^(LocalDateTable_|DateTableTemplate_)/i.test(name);
}
