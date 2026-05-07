// "Lift" arbitrary Tailwind values from the polished JSX into a globals.css
// @theme block, then rewrite each page.tsx to use the named tokens.
//
// Workflow:
// 1. Walk app/<board>/page.tsx files, regex-extract every Tailwind class with an
//    arbitrary value: bg-[#1F3DD9], text-[16px], rounded-[12px], font-[...], etc.
// 2. Categorize and aggregate (counts + which files use each value).
// 3. One Claude call: produce a Tailwind v4 @theme block + a class replacement
//    map. Claude consolidates near-duplicates (e.g. two slightly different blues
//    that play the same role) and names tokens semantically.
// 4. Rewrite app/globals.css preserving any non-theme content.
// 5. Apply the replacement map to every page.tsx (literal substring on classNames).

import Anthropic from "@anthropic-ai/sdk";
import type { Message, MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { readdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

interface TokenUsage {
  value: string; // e.g. "#1F3DD9", "16px", "Inter,system-ui,sans-serif"
  // Each occurrence: which file, which Tailwind utility prefix used it
  occurrences: Array<{ file: string; tailwindClass: string }>;
}

interface Inventory {
  color: TokenUsage[];
  fontSize: TokenUsage[];
  fontFamily: TokenUsage[];
  radius: TokenUsage[];
  shadow: TokenUsage[];
  tracking: TokenUsage[];
  leading: TokenUsage[];
}

// Patterns we extract. Layout (left/top/width/height/padding) is intentionally
// excluded — it's per-shape positional data, not a theme concern.
const PATTERNS: Array<{ category: keyof Inventory; re: RegExp; valueGroup: number }> = [
  { category: "color",      re: /\b((?:bg|text|border|fill|stroke|ring|outline|decoration|caret|accent|placeholder|via|from|to)(?:-(?:tl|tr|bl|br|t|r|b|l|x|y))?)-\[(#[0-9a-fA-F]{3,8}|rgb[a]?\([^)]+\)|hsl[a]?\([^)]+\))\]/g, valueGroup: 2 },
  { category: "fontSize",   re: /\b(text)-\[(\d+(?:\.\d+)?(?:px|rem|em))(?:\/[^\]]*)?\]/g, valueGroup: 2 },
  { category: "fontFamily", re: /\b(font)-\[([^[\]]+)\]/g, valueGroup: 2 },
  { category: "radius",     re: /\b(rounded(?:-(?:tl|tr|bl|br|t|r|b|l|s|e|ss|se|es|ee))?)-\[(\d+(?:\.\d+)?(?:px|rem|%))\]/g, valueGroup: 2 },
  { category: "shadow",     re: /\b(shadow|drop-shadow)-\[([^\]]+)\]/g, valueGroup: 2 },
  { category: "tracking",   re: /\b(tracking)-\[([^\]]+)\]/g, valueGroup: 2 },
  { category: "leading",    re: /\b(leading)-\[([^\]]+)\]/g, valueGroup: 2 },
];

function emptyInventory(): Inventory {
  return { color: [], fontSize: [], fontFamily: [], radius: [], shadow: [], tracking: [], leading: [] };
}

function addOccurrence(list: TokenUsage[], value: string, file: string, tailwindClass: string): void {
  let entry = list.find((u) => u.value === value);
  if (!entry) {
    entry = { value, occurrences: [] };
    list.push(entry);
  }
  entry.occurrences.push({ file, tailwindClass });
}

export function extractInventory(filesByPath: Record<string, string>): Inventory {
  const inv = emptyInventory();
  for (const [file, jsx] of Object.entries(filesByPath)) {
    for (const { category, re, valueGroup } of PATTERNS) {
      // Reset regex state — these are global patterns.
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(jsx)) !== null) {
        const tailwindClass = m[0]!;
        const value = m[valueGroup]!;
        addOccurrence(inv[category], value, file, tailwindClass);
      }
    }
  }
  return inv;
}

async function findPageFiles(projectDir: string): Promise<string[]> {
  const appDir = join(projectDir, "app");
  const out: string[] = [];
  try {
    await stat(appDir);
  } catch {
    return out;
  }
  const entries = await readdir(appDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(appDir, entry.name, "page.tsx");
    try {
      await stat(candidate);
      out.push(candidate);
    } catch {
      /* not a board route */
    }
  }
  return out;
}

interface LiftPlan {
  themeCss: string;
  replacements: Array<{ from: string; to: string }>;
  notes?: string;
}

const LIFT_SYSTEM = `You are a senior design systems engineer. Given an inventory of arbitrary Tailwind v4 utility classes used across a codebase, produce a coherent Tailwind v4 @theme block AND a class replacement map.

CRITICAL RULES:
- Output strictly valid JSON matching the requested schema. No prose, no markdown, no code fences. JSON only.
- Tailwind v4 generates class prefixes from CSS variable namespaces in @theme:
    --color-NAME    → bg-NAME, text-NAME, border-NAME, ...
    --font-NAME     → font-NAME
    --text-NAME     → text-NAME (font-size scale; use names like "xs", "sm", "base", "lg", "xl", "2xl", "3xl")
    --radius-NAME   → rounded-NAME (use names like "sm", "md", "lg", "xl", "full")
    --shadow-NAME   → shadow-NAME
    --tracking-NAME → tracking-NAME
    --leading-NAME  → leading-NAME
- Consolidate near-duplicates. Two hex values that differ by a couple bits and are used in the same role should collapse to ONE token (pick the most-used as canonical).
- Name colors semantically by role inferred from usage context: "canvas" / "bg" / "ink" / "fg" / "mute" / "accent" / "border" / "subtle". Avoid generic numeric names ("color-1") unless the role is genuinely unclear.
- Replacement map: every original arbitrary-value class in the inventory must map to a clean named class. Example: "bg-[#1F3DD9]" → "bg-accent", "text-[16px]" → "text-base", "rounded-[12px]" → "rounded-md".
- The themeCss field must be a SINGLE @theme block (no @import, no other CSS).

Output schema:
{
  "themeCss": "@theme {\\n  --color-canvas: #FFFFFF;\\n  ...\\n}",
  "replacements": [
    { "from": "bg-[#1F3DD9]", "to": "bg-accent" },
    ...
  ],
  "notes": "<optional one-line summary of consolidations>"
}`;

function summarizeInventoryForLlm(inv: Inventory): string {
  const sections: string[] = [];
  for (const [category, list] of Object.entries(inv)) {
    if (list.length === 0) continue;
    sections.push(`# ${category}`);
    for (const u of list) {
      const usageCount = u.occurrences.length;
      const samplePrefixes = Array.from(new Set(u.occurrences.map((o: { tailwindClass: string }) => o.tailwindClass.split("-[")[0]))).slice(0, 4);
      const sampleFiles = Array.from(new Set(u.occurrences.map((o: { file: string }) => o.file.split("/").slice(-2).join("/"))));
      sections.push(`  - value: ${JSON.stringify(u.value)}  used ${usageCount}× via [${samplePrefixes.join(", ")}] in ${sampleFiles.join(", ")}`);
    }
  }
  return sections.join("\n");
}

export async function planLift(inv: Inventory, model?: string): Promise<LiftPlan> {
  const inventoryText = summarizeInventoryForLlm(inv);
  if (!inventoryText.trim()) {
    return { themeCss: "@theme {\n}", replacements: [], notes: "no arbitrary-value classes found" };
  }

  const client = new Anthropic();
  const messages: MessageParam[] = [
    {
      role: "user",
      content: `Inventory of arbitrary Tailwind v4 classes used across this codebase:\n\n${inventoryText}\n\nProduce the @theme block and replacement map. JSON only.`,
    },
  ];

  const response: Message = await client.messages.create({
    model: model ?? "claude-opus-4-7",
    max_tokens: 8192,
    system: LIFT_SYSTEM,
    messages,
  });

  const text = response.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim();
  // Be tolerant of accidental code fences.
  const cleaned = text.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
  let plan: LiftPlan;
  try {
    plan = JSON.parse(cleaned) as LiftPlan;
  } catch (err) {
    throw new Error(`Lift planner returned non-JSON output: ${text.slice(0, 500)}`);
  }
  if (!plan.themeCss || !Array.isArray(plan.replacements)) {
    throw new Error(`Lift plan missing themeCss or replacements`);
  }
  return plan;
}

function applyReplacements(jsx: string, replacements: Array<{ from: string; to: string }>): string {
  // Replace within className="..." attributes only, to avoid clobbering text content.
  // Sort by descending length so longer strings replace first (avoid prefix collisions).
  const sorted = [...replacements].sort((a, b) => b.from.length - a.from.length);
  return jsx.replace(/className="([^"]*)"/g, (_full, classes: string) => {
    let next = ` ${classes} `; // pad so word-boundary replacements work
    for (const { from, to } of sorted) {
      const fromPadded = ` ${from} `;
      while (next.includes(fromPadded)) {
        next = next.replace(fromPadded, ` ${to} `);
      }
    }
    return `className="${next.trim().replace(/\s+/g, " ")}"`;
  });
}

function mergeThemeIntoGlobalsCss(existing: string, themeCss: string): string {
  // Strip any prior @theme block AND any @import "tailwindcss" — we always re-emit them.
  const withoutTheme = existing.replace(/@theme\s*\{[^}]*\}\s*/m, "");
  const rest = withoutTheme.replace(/@import\s+["']tailwindcss["'];?\s*/g, "").trim();
  const lines: string[] = [`@import "tailwindcss";`, "", themeCss.trim(), ""];
  if (rest) {
    lines.push(rest, "");
  }
  return lines.join("\n");
}

export interface LiftOptions {
  projectDir: string;
  model?: string;
  dryRun?: boolean;
}

export interface LiftResult {
  filesScanned: number;
  uniqueValues: number;
  replacementCount: number;
  themeCssWritten: boolean;
  notes?: string;
}

export async function lift({ projectDir, model, dryRun }: LiftOptions): Promise<LiftResult> {
  const pageFiles = await findPageFiles(projectDir);
  if (pageFiles.length === 0) {
    throw new Error(`No app/<board>/page.tsx files found under ${projectDir}`);
  }

  const filesByPath: Record<string, string> = {};
  for (const f of pageFiles) {
    filesByPath[f] = await readFile(f, "utf8");
  }

  const inv = extractInventory(filesByPath);
  const uniqueValues = Object.values(inv).reduce((sum, list) => sum + list.length, 0);
  if (uniqueValues === 0) {
    return { filesScanned: pageFiles.length, uniqueValues: 0, replacementCount: 0, themeCssWritten: false, notes: "no arbitrary-value classes found — nothing to lift" };
  }

  const plan = await planLift(inv, model);

  if (!dryRun) {
    // Write globals.css
    const globalsPath = join(projectDir, "app", "globals.css");
    let existing = "";
    try {
      existing = await readFile(globalsPath, "utf8");
    } catch {
      /* fresh file */
    }
    const merged = mergeThemeIntoGlobalsCss(existing, plan.themeCss);
    await writeFile(globalsPath, merged);

    // Apply replacements to every page.tsx
    for (const file of pageFiles) {
      const next = applyReplacements(filesByPath[file]!, plan.replacements);
      await writeFile(file, next);
    }
  }

  return {
    filesScanned: pageFiles.length,
    uniqueValues,
    replacementCount: plan.replacements.length,
    themeCssWritten: !dryRun,
    notes: plan.notes,
  };
}

if (import.meta.main) {
  const projectDir = process.argv[2] ?? ".";
  const dryRun = process.argv.includes("--dry-run");
  const modelIdx = process.argv.indexOf("--model");
  const model = modelIdx !== -1 ? process.argv[modelIdx + 1] : undefined;
  const result = await lift({ projectDir, model, dryRun });
  console.log(`lift: scanned ${result.filesScanned} files, ${result.uniqueValues} unique values, ${result.replacementCount} replacements${dryRun ? " (dry-run)" : ""}`);
  if (result.notes) console.log(`  notes: ${result.notes}`);
}
