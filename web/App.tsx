import { useMemo, useState } from "react";
import {
  analyze,
  loadModelFromParts,
  renderMarkdown,
  type AnalysisResult,
  type Finding,
  type Severity,
} from "../src/index.js";
import sampleBim from "../samples/contoso-bad.model.bim?raw";

const SEVERITIES: Severity[] = ["error", "warning", "info"];

export function App() {
  const [content, setContent] = useState("");
  const [modelName, setModelName] = useState("semantic-model");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Set<Severity>>(new Set(SEVERITIES));
  const [query, setQuery] = useState("");

  const runAnalysis = (text: string, name: string) => {
    try {
      const model = loadModelFromParts([{ path: "model.bim", content: text }], name);
      setResult(analyze(model));
      setError(null);
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    }
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    const name = file.name.replace(/\.(bim|tmsl|json)$/i, "");
    setContent(text);
    setModelName(name);
    runAnalysis(text, name);
  };

  const loadSample = () => {
    setContent(sampleBim);
    setModelName("Contoso (sample)");
    runAnalysis(sampleBim, "Contoso (sample)");
  };

  const toggle = (sev: Severity) => {
    const next = new Set(active);
    next.has(sev) ? next.delete(sev) : next.add(sev);
    setActive(next);
  };

  const visible = useMemo(() => {
    if (!result) return [];
    const q = query.trim().toLowerCase();
    return result.findings.filter(
      (f) =>
        active.has(f.severity) &&
        (q === "" ||
          f.message.toLowerCase().includes(q) ||
          f.ruleId.toLowerCase().includes(q) ||
          (f.target ?? "").toLowerCase().includes(q)),
    );
  }, [result, active, query]);

  const copyMarkdown = async () => {
    if (result) await navigator.clipboard.writeText(renderMarkdown(result));
  };

  return (
    <div className="app">
      <header className="header">
        <h1>Semantic Model Analyzer</h1>
        <p>
          Analyze a Power BI / Fabric semantic model against{" "}
          <a
            href="https://learn.microsoft.com/en-us/fabric/data-science/semantic-model-best-practices"
            target="_blank"
            rel="noreferrer"
          >
            best practices
          </a>
          . Everything runs locally in your browser.
        </p>
      </header>

      <section className="input">
        <div className="toolbar">
          <label className="btn">
            Upload model.bim
            <input
              type="file"
              accept=".bim,.json,.tmsl"
              hidden
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
          <button className="btn" onClick={loadSample}>
            Load sample
          </button>
          <button
            className="btn primary"
            onClick={() => runAnalysis(content, modelName)}
            disabled={!content.trim()}
          >
            Analyze
          </button>
        </div>
        <textarea
          className="editor"
          placeholder="Paste a TMSL model.bim JSON definition here…"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
        />
      </section>

      {error && <div className="error">Error: {error}</div>}

      {result && (
        <section className="results">
          <div className="summary">
            <div className="stats">
              <strong>{result.modelName}</strong>
              <span className="muted">
                {result.sourceFormat} · {result.stats.tables} tables · {result.stats.columns} columns
                · {result.stats.measures} measures · {result.stats.relationships} relationships
              </span>
            </div>
            <div className="chips">
              {SEVERITIES.map((sev) => (
                <button
                  key={sev}
                  className={`chip ${sev} ${active.has(sev) ? "on" : "off"}`}
                  onClick={() => toggle(sev)}
                >
                  {countFor(result.findings, sev)} {sev}
                </button>
              ))}
              <input
                className="search"
                placeholder="Filter…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button className="btn" onClick={copyMarkdown}>
                Copy Markdown
              </button>
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="muted empty">No findings match the current filter.</p>
          ) : (
            <ul className="findings">
              {visible.map((f, i) => (
                <FindingRow key={i} finding={f} />
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className={`finding ${finding.severity}`}>
      <div className="finding-head">
        <span className={`badge ${finding.severity}`}>{finding.severity}</span>
        <code className="rule">{finding.ruleId}</code>
        {finding.target && <span className="target">{finding.target}</span>}
      </div>
      <div className="finding-msg">{finding.message}</div>
      <div className="finding-rec">
        {finding.recommendation}
        {finding.docUrl && (
          <>
            {" "}
            <a href={finding.docUrl} target="_blank" rel="noreferrer">
              docs
            </a>
          </>
        )}
      </div>
    </li>
  );
}

function countFor(findings: Finding[], sev: Severity): number {
  return findings.filter((f) => f.severity === sev).length;
}
