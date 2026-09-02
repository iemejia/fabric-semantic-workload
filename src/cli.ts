#!/usr/bin/env node
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { Command } from "commander";
import { analyze } from "./analyzer/engine.js";
import type { Severity } from "./analyzer/types.js";
import { FabricClient, type DefinitionFormat } from "./fabric/client.js";
import { loadModelFromParts, type DefinitionPart } from "./model/load.js";
import { renderConsole } from "./report/console.js";
import { renderMarkdown } from "./report/markdown.js";

const program = new Command();

program
  .name("fsma")
  .description("Analyze Microsoft Fabric / Power BI semantic models against best practices")
  .version("0.1.0");

program
  .command("analyze")
  .description("Analyze a semantic model and report best-practice findings")
  .option("-w, --workspace <id>", "Fabric workspace ID (with --model)")
  .option("-m, --model <id>", "Semantic model ID (with --workspace)")
  .option("-f, --file <path>", "Local TMSL model.bim file")
  .option("-d, --folder <path>", "Local folder containing a TMDL/PBIP semantic model definition")
  .option("--name <name>", "Override the reported model name")
  .option("--format <format>", "Remote definition format: TMSL | TMDL", "TMSL")
  .option("--output <kind>", "Output format: console | markdown | json", "console")
  .option("--out <file>", "Write the report to a file instead of stdout")
  .option("--min-severity <sev>", "Only show findings at/above: error | warning | info")
  .option("--fail-on <sev>", "Exit non-zero if a finding at/above this severity exists")
  .option("--token <bearer>", "Raw bearer token for the Fabric API (overrides az login)")
  .option("--no-color", "Disable colored console output")
  .action(async (opts) => {
    try {
      await runAnalyze(opts);
    } catch (err) {
      console.error(`\nError: ${(err as Error).message}\n`);
      process.exitCode = 2;
    }
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exitCode = 2;
});

interface AnalyzeOpts {
  workspace?: string;
  model?: string;
  file?: string;
  folder?: string;
  name?: string;
  format: string;
  output: string;
  out?: string;
  minSeverity?: Severity;
  failOn?: Severity;
  token?: string;
  color: boolean;
}

async function runAnalyze(opts: AnalyzeOpts): Promise<void> {
  const parts = await resolveParts(opts);
  const modelName = opts.name ?? defaultModelName(opts);
  const model = loadModelFromParts(parts, modelName);

  const result = analyze(model, { minSeverity: opts.minSeverity });

  let rendered: string;
  switch (opts.output) {
    case "json":
      rendered = JSON.stringify(result, null, 2);
      break;
    case "markdown":
      rendered = renderMarkdown(result);
      break;
    case "console":
      rendered = renderConsole(result, opts.color && !opts.out);
      break;
    default:
      throw new Error(`Unknown --output "${opts.output}". Use console | markdown | json.`);
  }

  if (opts.out) {
    await writeFile(opts.out, rendered, "utf-8");
    console.error(`Report written to ${opts.out}`);
  } else {
    process.stdout.write(rendered + "\n");
  }

  if (opts.failOn) {
    const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
    const threshold = order[opts.failOn];
    const hit = result.findings.some((f) => order[f.severity] <= threshold);
    if (hit) process.exitCode = 1;
  }
}

async function resolveParts(opts: AnalyzeOpts): Promise<DefinitionPart[]> {
  if (opts.file) {
    const content = await readFile(opts.file, "utf-8");
    return [{ path: "model.bim", content }];
  }
  if (opts.folder) {
    return readFolderParts(opts.folder);
  }
  if (opts.workspace && opts.model) {
    const client = new FabricClient({ token: opts.token });
    const format = normalizeFormat(opts.format);
    console.error(`Fetching definition (format=${format})…`);
    return client.getSemanticModelDefinition(opts.workspace, opts.model, { format });
  }
  throw new Error(
    "Provide an input: --file <model.bim>, --folder <definition>, or --workspace <id> --model <id>.",
  );
}

async function readFolderParts(root: string): Promise<DefinitionPart[]> {
  const parts: DefinitionPart[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (/\.(tmdl|bim|pbism|md|json)$/i.test(entry.name)) {
        const content = await readFile(full, "utf-8");
        parts.push({ path: relative(root, full).split(sep).join("/"), content });
      }
    }
  };
  const s = await stat(root);
  if (!s.isDirectory()) throw new Error(`--folder must be a directory: ${root}`);
  await walk(root);
  if (parts.length === 0) throw new Error(`No semantic model definition files found under ${root}`);
  return parts;
}

function normalizeFormat(format: string): DefinitionFormat {
  const f = format.toUpperCase();
  if (f !== "TMSL" && f !== "TMDL") throw new Error(`--format must be TMSL or TMDL, got "${format}".`);
  return f;
}

function defaultModelName(opts: AnalyzeOpts): string {
  if (opts.file) return baseName(opts.file);
  if (opts.folder) return baseName(opts.folder);
  return opts.model ?? "semantic-model";
}

function baseName(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop()?.replace(/\.(bim|tmsl)$/i, "") ?? p;
}
