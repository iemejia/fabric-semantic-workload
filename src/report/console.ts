import type { AnalysisResult, Severity } from "../analyzer/types.js";

const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

const SEVERITY_STYLE: Record<Severity, { label: string; color: string }> = {
  error: { label: "ERROR", color: COLORS.red },
  warning: { label: "WARN", color: COLORS.yellow },
  info: { label: "INFO", color: COLORS.cyan },
};

/** Render an analysis result as a human-readable, colorized console report. */
export function renderConsole(result: AnalysisResult, useColor = true): string {
  const c = (code: string, text: string) => (useColor ? `${code}${text}${COLORS.reset}` : text);
  const lines: string[] = [];

  lines.push("");
  lines.push(c(COLORS.bold, `Semantic model analysis: ${result.modelName}`));
  lines.push(
    c(
      COLORS.gray,
      `format=${result.sourceFormat}  tables=${result.stats.tables}  columns=${result.stats.columns}  measures=${result.stats.measures}  relationships=${result.stats.relationships}`,
    ),
  );
  lines.push("");

  if (result.findings.length === 0) {
    lines.push(c(COLORS.cyan, "No findings. The model looks good against the built-in best-practice rules."));
    lines.push("");
    return lines.join("\n");
  }

  for (const f of result.findings) {
    const style = SEVERITY_STYLE[f.severity];
    const badge = c(style.color, style.label.padEnd(5));
    const target = f.target ? c(COLORS.dim, ` ${f.target}`) : "";
    lines.push(`${badge} ${c(COLORS.gray, `[${f.ruleId}]`)}${target}`);
    lines.push(`      ${f.message}`);
    lines.push(`      ${c(COLORS.dim, "→ " + f.recommendation)}`);
    lines.push("");
  }

  const s = result.summary;
  lines.push(c(COLORS.bold, "Summary"));
  lines.push(
    `  ${c(COLORS.red, `${s.error} error`)}  ${c(COLORS.yellow, `${s.warning} warning`)}  ${c(
      COLORS.cyan,
      `${s.info} info`,
    )}  (total ${s.total})`,
  );
  const cats = Object.entries(s.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${cat}:${n}`)
    .join("  ");
  if (cats) lines.push(c(COLORS.gray, `  by category: ${cats}`));
  lines.push("");

  return lines.join("\n");
}
