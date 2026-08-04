import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Prompts live in /prompts as versioned files (prompts/<name>/v<N>.md) —
 * never inline in code. A prompt change = a new version file.
 * File format: "## System" and "## User" sections; {{var}} placeholders.
 */
export interface LoadedPrompt { system: string; user: string; version: string }

export async function loadPrompt(name: string, version = "v1"): Promise<LoadedPrompt> {
  const file = path.join(process.cwd(), "prompts", name, `${version}.md`);
  const raw = await readFile(file, "utf8");
  const sys = raw.split(/^## System\s*$/m)[1]?.split(/^## User\s*$/m)[0]?.trim();
  const user = raw.split(/^## User\s*$/m)[1]?.trim();
  if (!sys || !user) throw new Error(`Prompt ${name}/${version} missing ## System or ## User section`);
  return { system: sys, user, version };
}

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error(`Missing prompt variable {{${k}}}`);
    return vars[k];
  });
}
