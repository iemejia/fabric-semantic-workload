import { loadFromTmsl } from "./tmsl.js";
import { loadFromTmdl, type TmdlFile } from "./tmdl.js";
import type { AiReadiness, SemanticModel } from "./types.js";

/** A decoded definition part (base64 already decoded to UTF-8 text). */
export interface DefinitionPart {
  path: string;
  content: string;
}

/**
 * Build a normalized {@link SemanticModel} from the decoded parts returned by
 * the Fabric `getDefinition` API (or read from disk). Auto-detects TMSL vs TMDL
 * and layers in Prep-for-AI / Copilot readiness signals.
 */
export function loadModelFromParts(parts: DefinitionPart[], modelName: string): SemanticModel {
  const bimPart = parts.find((p) => normalize(p.path).endsWith("model.bim"));
  const tmdlParts = parts.filter((p) => normalize(p.path).endsWith(".tmdl"));

  let model: SemanticModel;
  if (bimPart) {
    model = loadFromTmsl(JSON.parse(bimPart.content), modelName);
  } else if (tmdlParts.length > 0) {
    const files: TmdlFile[] = tmdlParts.map((p) => ({ path: p.path, content: p.content }));
    model = loadFromTmdl(files, modelName);
  } else {
    throw new Error(
      "No semantic model definition found: expected a TMSL 'model.bim' part or TMDL '.tmdl' parts.",
    );
  }

  model.ai = readAiReadiness(parts);
  return model;
}

function readAiReadiness(parts: DefinitionPart[]): AiReadiness {
  const ai: AiReadiness = { hasVerifiedAnswers: false };

  const instructions = parts.find((p) => /Copilot\/Instructions\/instructions\.md$/i.test(normalize(p.path)));
  if (instructions && instructions.content.trim()) {
    ai.instructions = instructions.content.trim();
  }

  ai.hasVerifiedAnswers = parts.some((p) => /Copilot\/VerifiedAnswers\//i.test(normalize(p.path)) && p.content.trim().length > 0);

  const pbism = parts.find((p) => normalize(p.path).endsWith("definition.pbism"));
  if (pbism) {
    try {
      const parsed = JSON.parse(pbism.content) as { settings?: { qnaEnabled?: boolean } };
      ai.qnaEnabled = parsed.settings?.qnaEnabled;
    } catch {
      // ignore malformed pbism
    }
  }

  return ai;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/");
}
