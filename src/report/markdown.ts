import type { AnalysisResult, Finding } from "../analyzer/types.js";

const SEVERITY_EMOJI: Record<Finding["severity"], string> = {
  error: "🔴",
  warning: "🟡",
  info: "🔵",
};

/** Render an analysis result as a Markdown report suitable for sharing in PRs. */
export function renderMarkdown(result: AnalysisResult): string {
  const s = result.summary;
  const lines: string[] = [];

  lines.push(`# Semantic model analysis: ${result.modelName}`);
  lines.push("");
  lines.push(
    `**Format:** ${result.sourceFormat} · **Tables:** ${result.stats.tables} · **Columns:** ${result.stats.columns} · **Measures:** ${result.stats.measures} · **Relationships:** ${result.stats.relationships}`,
  );
  lines.push("");
  lines.push(`**Findings:** ${s.total} (🔴 ${s.error} · 🟡 ${s.warning} · 🔵 ${s.info})`);
  lines.push("");

  if (result.findings.length === 0) {
    lines.push("No findings. The model looks good against the built-in best-practice rules.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push("| Severity | Rule | Target | Finding | Recommendation |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const f of result.findings) {
    const rule = f.docUrl ? `[${f.ruleId}](${f.docUrl})` : f.ruleId;
    lines.push(
      `| ${SEVERITY_EMOJI[f.severity]} ${f.severity} | ${rule} | ${md(f.target ?? "")} | ${md(
        f.message,
      )} | ${md(f.recommendation)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function md(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
