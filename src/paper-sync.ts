// Read polished styles from Paper and regenerate the className for each data-shape
// element in the board's page.tsx. Layout classes come from flow-spec.json (Penpot's
// truth). Visual classes come from Paper.
//
// The sync writes Tailwind v4 classes (with arbitrary values for one-offs) into the
// className attribute and removes any inline `style` attribute on the synced elements.
// Engineering can later refactor these to project-specific tokens.

import { connect } from "./mcp.js";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlowSpec, Shape } from "./types.js";
import { cssToTailwind } from "./css-to-tailwind.js";
import { shapeLayoutClasses } from "./scaffold.js";

interface Manifest {
  board: string;
  artboardId: string;
  shapeMapping: Record<string, string>;
}

// Visual properties to copy from Paper. Layout/positioning is intentionally excluded —
// it's owned by Penpot and lives in flow-spec.json.
const VISUAL_PROPS = new Set([
  "backgroundColor",
  "color",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "boxShadow",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "fontStyle",
  "textAlign",
  "textDecoration",
  "textTransform",
  "borderColor",
  "borderWidth",
  "borderStyle",
  "opacity",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
]);

function camel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function pickVisualStyles(computed: Record<string, string>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [key, val] of Object.entries(computed)) {
    if (val === undefined || val === null || val === "") continue;
    const c = camel(key);
    if (VISUAL_PROPS.has(c)) out[c] = val;
  }
  return out;
}

// Tailwind classes that come from the scaffold's "placeholder" baseline.
// We strip these on sync since the polished design replaces them.
const PLACEHOLDER_PREFIXES_TO_STRIP = [
  "bg-zinc-",
  "text-zinc-",
  "rounded",
  "rounded-",
  "text-[",
  "bg-[",
  "shadow-[",
  "tracking-[",
  "leading-[",
  "font-[",
  "uppercase",
  "lowercase",
  "capitalize",
  "italic",
  "not-italic",
  "underline",
  "no-underline",
  "line-through",
  "border-",
  "opacity-",
  "p-[",
  "pt-[",
  "pr-[",
  "pb-[",
  "pl-[",
  "font-thin",
  "font-extralight",
  "font-light",
  "font-normal",
  "font-medium",
  "font-semibold",
  "font-bold",
  "font-extrabold",
  "font-black",
];

function isVisualClass(token: string): boolean {
  return PLACEHOLDER_PREFIXES_TO_STRIP.some((p) => token === p || token.startsWith(p));
}

function buildClassName(layoutClasses: string[], visualClasses: string[], baseClasses: string[]): string {
  // Order: layout first (positional invariants), then base (e.g. "absolute" already in layout, "flex"), then visual.
  // De-dupe by exact token.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of [...layoutClasses, ...baseClasses, ...visualClasses]) {
    if (!c || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out.join(" ");
}

interface JsxShapeMatch {
  startLine: number;
  endLine: number;
  tag: "div" | "button";
  shapeName: string;
  classNameStart: number; // char index in line where the className value starts (after `className="`)
  classNameEnd: number;
  // We only support one-line elements per the scaffold's output format.
}

function findShapeInJsx(lines: string[], shapeName: string): JsxShapeMatch | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.includes(`data-shape={${JSON.stringify(shapeName)}}`)) continue;
    const tagM = line.match(/<(div|button)\s/);
    if (!tagM) continue;
    const classStart = line.indexOf('className="');
    if (classStart === -1) continue;
    const valueStart = classStart + 'className="'.length;
    const valueEnd = line.indexOf('"', valueStart);
    if (valueEnd === -1) continue;
    return {
      startLine: i,
      endLine: i,
      tag: tagM[1] as "div" | "button",
      shapeName,
      classNameStart: valueStart,
      classNameEnd: valueEnd,
    };
  }
  return null;
}

function rewriteJsx(
  jsx: string,
  spec: FlowSpec,
  boardName: string,
  shapeStyles: Record<string, Record<string, string | number>>,
): string {
  const lines = jsx.split("\n");
  const boardShapes = spec.boardShapes[boardName] ?? [];
  const shapesByName = new Map<string, Shape>(boardShapes.map((s) => [s.name, s]));

  for (const [shapeName, visualCss] of Object.entries(shapeStyles)) {
    const shape = shapesByName.get(shapeName);
    if (!shape) continue;
    const match = findShapeInJsx(lines, shapeName);
    if (!match) continue;

    const layout = shapeLayoutClasses(shape);
    const { classes: visual } = cssToTailwind(visualCss);

    // Preserve any "structural" classes the user added by hand or the scaffold's button/flex extras.
    const existingLine = lines[match.startLine];
    if (!existingLine) continue;
    const existingClasses = existingLine
      .slice(match.classNameStart, match.classNameEnd)
      .split(/\s+/)
      .filter(Boolean);
    const base = existingClasses.filter((c) => !isVisualClass(c) && !layout.includes(c));

    const newClassName = buildClassName(layout, visual, base);
    lines[match.startLine] = existingLine.slice(0, match.classNameStart) + newClassName + existingLine.slice(match.classNameEnd);
  }

  return lines.join("\n");
}

export interface PaperSyncOptions {
  projectDir: string;
  boardName: string;
}

export async function paperSync({ projectDir, boardName }: PaperSyncOptions): Promise<{ updated: number; total: number }> {
  const manifestPath = join(projectDir, ".inkpot", `${boardName}.paper.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const specPath = join(projectDir, "flow-spec.json");
  const spec = JSON.parse(await readFile(specPath, "utf8")) as FlowSpec;

  const paper = await connect("paper");
  const nodeIds = Object.values(manifest.shapeMapping);
  const styles = (await paper.call("get_computed_styles", { nodeIds })) as Record<string, Record<string, string>>;

  const shapeStyles: Record<string, Record<string, string | number>> = {};
  let updatedCount = 0;
  for (const [shapeName, nodeId] of Object.entries(manifest.shapeMapping)) {
    const computed = styles[nodeId];
    if (!computed) continue;
    const picked = pickVisualStyles(computed);
    if (Object.keys(picked).length === 0) continue;
    shapeStyles[shapeName] = picked;
    updatedCount++;
  }

  const pagePath = join(projectDir, "app", boardName, "page.tsx");
  const jsx = await readFile(pagePath, "utf8");
  const next = rewriteJsx(jsx, spec, boardName, shapeStyles);
  await writeFile(pagePath, next);

  return { updated: updatedCount, total: Object.keys(manifest.shapeMapping).length };
}

if (import.meta.main) {
  const [projectDir, boardName] = process.argv.slice(2);
  if (!projectDir || !boardName) {
    console.error("Usage: paper-sync <project-dir> <board-name>");
    process.exit(1);
  }
  const result = await paperSync({ projectDir, boardName });
  console.log(`paper-sync: updated styles on ${result.updated}/${result.total} shapes`);
}
