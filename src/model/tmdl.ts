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
 * A single TMDL file (path + text). Typically one file per table plus
 * model.tmdl / database.tmdl / relationships.tmdl.
 */
export interface TmdlFile {
  path: string;
  content: string;
}

/**
 * Best-effort loader for the TMDL public-definition format.
 *
 * TMDL is an indentation-based DSL. This parser covers the constructs the
 * analyzer needs (tables, columns, measures, partitions, relationships and
 * their common properties + `///` descriptions). It is intentionally lenient:
 * unknown lines are ignored rather than causing a hard failure. For maximum
 * fidelity, prefer the TMSL loader.
 */
export function loadFromTmdl(files: TmdlFile[], modelName: string): SemanticModel {
  const tables: Table[] = [];
  const relationships: Relationship[] = [];
  let culture: string | undefined;
  let discourageImplicitMeasures: boolean | undefined;

  for (const file of files) {
    const base = file.path.split("/").pop() ?? file.path;
    if (base === "relationships.tmdl") {
      relationships.push(...parseRelationships(file.content));
    } else if (base === "model.tmdl" || base === "database.tmdl") {
      const modelProps = parseModelProps(file.content);
      culture ??= modelProps.culture;
      if (discourageImplicitMeasures === undefined) {
        discourageImplicitMeasures = modelProps.discourageImplicitMeasures;
      }
      // model.tmdl can also declare relationships inline in some exports.
      relationships.push(...parseRelationships(file.content));
    } else {
      tables.push(...parseTables(file.content));
    }
  }

  return {
    name: modelName,
    culture,
    discourageImplicitMeasures,
    tables,
    relationships,
    ai: { hasVerifiedAnswers: false },
    sourceFormat: "TMDL",
  };
}

interface Line {
  indent: number;
  text: string; // trimmed
  raw: string; // without leading whitespace, keeps inline tabs
}

function tokenize(content: string): Line[] {
  const out: Line[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    if (rawLine.trim() === "") continue;
    const match = /^([ \t]*)(.*)$/.exec(rawLine)!;
    const indent = match[1].replace(/\t/g, " ").length; // tabs and spaces count 1 each
    out.push({ indent, text: match[2].trimEnd(), raw: match[2].replace(/\s+$/, "") });
  }
  return out;
}

const BLOCK_KEYWORDS = new Set([
  "table",
  "column",
  "measure",
  "partition",
  "hierarchy",
  "relationship",
  "role",
  "perspective",
]);

function keywordOf(text: string): string | undefined {
  const kw = text.split(/\s+/, 1)[0];
  return BLOCK_KEYWORDS.has(kw) ? kw : undefined;
}

function parseTables(content: string): Table[] {
  const lines = tokenize(content);
  const tables: Table[] = [];
  let pendingDescription: string[] = [];

  let current: Table | undefined;
  let currentIndent = -1;

  // Child object being filled (column/measure/partition) within current table.
  let child: { kind: string; obj: Column | Measure | Partition; indent: number } | undefined;
  let childDescription: string[] = [];

  const flushChild = () => {
    if (!current || !child) return;
    if (childDescription.length) {
      (child.obj as { description?: string }).description = childDescription.join("\n");
    }
    if (child.kind === "column") current.columns.push(child.obj as Column);
    else if (child.kind === "measure") current.measures.push(child.obj as Measure);
    else if (child.kind === "partition") current.partitions.push(child.obj as Partition);
    child = undefined;
    childDescription = [];
  };

  const flushTable = () => {
    flushChild();
    if (current) {
      current.isDateTable =
        current.dataCategory?.toLowerCase() === "time" ||
        current.columns.some((c) => c.dataCategory?.toLowerCase() === "time");
      tables.push(current);
    }
    current = undefined;
    currentIndent = -1;
  };

  for (const line of lines) {
    if (line.text.startsWith("///")) {
      const desc = line.text.replace(/^\/\/\/\s?/, "");
      if (child) childDescription.push(desc);
      else pendingDescription.push(desc);
      continue;
    }

    const kw = keywordOf(line.text);

    if (kw === "table") {
      flushTable();
      current = newTable(parseName(line.text, "table"));
      currentIndent = line.indent;
      if (pendingDescription.length) current.description = pendingDescription.join("\n");
      pendingDescription = [];
      continue;
    }

    if (!current) {
      pendingDescription = [];
      continue;
    }

    if (kw === "column" || kw === "measure" || kw === "partition") {
      flushChild();
      child = { kind: kw, obj: newChild(kw, line), indent: line.indent };
      applyInlineProps(kw, child.obj, line.raw);
      if (pendingDescription.length) {
        (child.obj as { description?: string }).description = pendingDescription.join("\n");
        pendingDescription = [];
      }
      continue;
    }

    if (kw) {
      // Some other block (hierarchy/role/...) — stop filling the current child.
      flushChild();
      continue;
    }

    // A property line.
    if (child && line.indent > child.indent) {
      applyProp(child.kind, child.obj, line.text);
    } else if (line.indent > currentIndent) {
      applyTableProp(current, line.text);
    }
  }

  flushTable();
  return tables;
}

function newTable(name: string): Table {
  return {
    name,
    isHidden: false,
    columns: [],
    measures: [],
    partitions: [],
    isAutoDateTable: isAutoDateTableName(name),
    isDateTable: false,
  };
}

function newChild(kind: string, line: Line): Column | Measure | Partition {
  if (kind === "column") {
    return {
      name: parseName(line.text, "column"),
      isHidden: false,
      isKey: false,
      isCalculated: /=/.test(line.text.replace(/^column\s+\S+/, "")), // `column X = <expr>` => calculated
    } satisfies Column;
  }
  if (kind === "measure") {
    const { name, expression } = parseAssignment(line.text, "measure");
    return { name, expression, isHidden: false } satisfies Measure;
  }
  const { name } = parseAssignment(line.text, "partition");
  return { name } satisfies Partition;
}

function applyInlineProps(kind: string, obj: Column | Measure | Partition, raw: string): void {
  // Inline properties are tab-separated after the declaration head.
  const parts = raw.split("\t");
  for (let i = 1; i < parts.length; i++) {
    const token = parts[i].trim();
    if (token) applyProp(kind, obj, token);
  }
}

function applyProp(kind: string, obj: Column | Measure | Partition, text: string): void {
  const { key, value, hasValue } = parseProp(text);
  const set = (k: string, v: unknown) => ((obj as unknown as Record<string, unknown>)[k] = v);

  switch (key) {
    case "dataType":
      set("dataType", value);
      break;
    case "summarizeBy":
      set("summarizeBy", value);
      break;
    case "dataCategory":
      set("dataCategory", value);
      break;
    case "sortByColumn":
      set("sortByColumn", value);
      break;
    case "sourceColumn":
      set("sourceColumn", value);
      break;
    case "formatString":
      set("formatString", value);
      break;
    case "displayFolder":
      set("displayFolder", value);
      break;
    case "mode":
      set("mode", value);
      break;
    case "isHidden":
      set("isHidden", hasValue ? value === "true" : true);
      break;
    case "isKey":
      set("isKey", hasValue ? value === "true" : true);
      break;
    default:
      break;
  }
}

function applyTableProp(table: Table, text: string): void {
  const { key, value, hasValue } = parseProp(text);
  if (key === "isHidden") table.isHidden = hasValue ? value === "true" : true;
  else if (key === "dataCategory") table.dataCategory = value;
}

interface ModelProps {
  culture?: string;
  discourageImplicitMeasures?: boolean;
}

function parseModelProps(content: string): ModelProps {
  const props: ModelProps = {};
  for (const line of tokenize(content)) {
    const { key, value } = parseProp(line.text);
    if (key === "culture") props.culture = value;
    else if (key === "discourageImplicitMeasures") props.discourageImplicitMeasures = value === "true";
  }
  return props;
}

function parseRelationships(content: string): Relationship[] {
  const lines = tokenize(content);
  const rels: Relationship[] = [];
  let current: Partial<Relationship> | undefined;
  let currentIndent = -1;

  const flush = () => {
    if (current && current.fromTable && current.toTable) {
      rels.push({
        name: current.name,
        fromTable: current.fromTable,
        fromColumn: current.fromColumn ?? "",
        toTable: current.toTable,
        toColumn: current.toColumn ?? "",
        crossFilteringBehavior: current.crossFilteringBehavior ?? "oneDirection",
        isActive: current.isActive ?? true,
        fromCardinality: current.fromCardinality ?? "many",
        toCardinality: current.toCardinality ?? "one",
      });
    }
    current = undefined;
  };

  for (const line of lines) {
    if (keywordOf(line.text) === "relationship") {
      flush();
      current = { name: parseName(line.text, "relationship") };
      currentIndent = line.indent;
      continue;
    }
    if (!current || line.indent <= currentIndent) continue;
    const { key, value } = parseProp(line.text);
    switch (key) {
      case "fromColumn": {
        const ref = splitColumnRef(value);
        current.fromTable = ref.table;
        current.fromColumn = ref.column;
        break;
      }
      case "toColumn": {
        const ref = splitColumnRef(value);
        current.toTable = ref.table;
        current.toColumn = ref.column;
        break;
      }
      case "crossFilteringBehavior":
        current.crossFilteringBehavior = value;
        break;
      case "isActive":
        current.isActive = value === "true";
        break;
      case "fromCardinality":
        current.fromCardinality = value;
        break;
      case "toCardinality":
        current.toCardinality = value;
        break;
      default:
        break;
    }
  }
  flush();
  return rels;
}

// --- parsing helpers --------------------------------------------------------

function parseName(text: string, keyword: string): string {
  const rest = text.slice(keyword.length).trim();
  return unquote(rest.split("\t")[0].split(" = ")[0].trim());
}

function parseAssignment(text: string, keyword: string): { name: string; expression?: string } {
  const rest = text.slice(keyword.length).trim();
  const head = rest.split("\t")[0];
  const eq = head.indexOf(" = ");
  if (eq === -1) return { name: unquote(head.trim()) };
  return {
    name: unquote(head.slice(0, eq).trim()),
    expression: head.slice(eq + 3).trim() || undefined,
  };
}

function parseProp(text: string): { key: string; value: string; hasValue: boolean } {
  const colon = text.indexOf(":");
  if (colon === -1) return { key: text.trim(), value: "", hasValue: false };
  return {
    key: text.slice(0, colon).trim(),
    value: text.slice(colon + 1).trim(),
    hasValue: true,
  };
}

function splitColumnRef(ref: string): { table: string; column: string } {
  const m = /^\s*('(?:[^']|'')+'|[^.]+)\.(.+)$/.exec(ref);
  if (!m) return { table: unquote(ref), column: "" };
  return { table: unquote(m[1].trim()), column: unquote(m[2].trim()) };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}
