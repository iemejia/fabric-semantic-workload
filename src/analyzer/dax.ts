/**
 * Minimal DAX dependency extraction.
 *
 * Given a DAX expression, find referenced measures (`[Measure]`) and columns
 * (`Table[Column]` / `'Table Name'[Column]`). This is a lexical approximation —
 * not a full DAX parser — but it is good enough to build a dependency graph and
 * to detect references to objects that no longer exist.
 */

export interface ColumnRef {
  table: string;
  column: string;
}

export interface DaxDependencies {
  measures: string[];
  columns: ColumnRef[];
}

const REF_RE = /('(?:[^']|'')*'|[A-Za-z_][\w]*)?\s*\[([^\]]+)\]/g;

export function extractDependencies(expression: string | undefined): DaxDependencies {
  const measures: string[] = [];
  const columns: ColumnRef[] = [];
  if (!expression) return { measures, columns };

  // Strip block/line comments and string literals so their contents are ignored.
  const cleaned = expression
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"]|"")*"/g, '""');

  const seenM = new Set<string>();
  const seenC = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = REF_RE.exec(cleaned)) !== null) {
    const tableRaw = m[1];
    const name = m[2].trim();
    if (tableRaw) {
      const table = unquote(tableRaw);
      const key = `${table.toLowerCase()}|${name.toLowerCase()}`;
      if (!seenC.has(key)) {
        seenC.add(key);
        columns.push({ table, column: name });
      }
    } else {
      const key = name.toLowerCase();
      if (!seenM.has(key)) {
        seenM.add(key);
        measures.push(name);
      }
    }
  }
  return { measures, columns };
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}
