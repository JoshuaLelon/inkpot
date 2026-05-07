// Send a scaffolded board to Paper as a polishable artboard.
//
// Reads flow-spec.json (the canonical source of board structure) rather than parsing JSX.
// Per-shape write_html keeps the name contract reliable; rename_nodes after each call
// labels the Paper layer with the Penpot shape name.
//
// Saves .inkpot/<board>.paper.json — manifest of shape-name → paper-node-id.

import { connect } from "./mcp.js";
import type { FlowSpec } from "./types.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";

interface ParsedShape {
  name: string;
  type: "div" | "button" | "text";
  bbox: { x: number; y: number; w: number; h: number };
  textContent?: string;
}

function shapesFromSpec(spec: FlowSpec, boardName: string): ParsedShape[] {
  const shapes = spec.boardShapes[boardName] ?? [];
  const interactions = spec.interactions.filter((ix) => ix.fromBoardName === boardName);
  return shapes.map((s) => {
    const isInteractive = interactions.some((ix) => ix.shapeId === s.id);
    const text = s.textContent ?? "";
    return {
      name: s.name,
      type: isInteractive ? "button" : text ? "text" : "div",
      bbox: s.bbox,
      textContent: text || undefined,
    };
  });
}

function renderSingleShape(s: ParsedShape): string {
  const style = `position:absolute;left:${s.bbox.x}px;top:${s.bbox.y}px;width:${s.bbox.w}px;height:${s.bbox.h}px;`;
  const inner = s.textContent ?? "";
  if (s.type === "button") {
    return `<div style="${style}background:#f4f4f5;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#3f3f46;font-size:13px;">${escape(inner || s.name)}</div>`;
  }
  if (s.type === "text") {
    return `<div style="${style}color:#0a0a0a;font-size:14px;">${escape(inner)}</div>`;
  }
  return `<div style="${style}background:#e4e4e7;border-radius:4px;"></div>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export interface PaperLoadOptions {
  projectDir: string;
  boardName: string;
}

export interface PaperLoadResult {
  artboardId: string;
  shapeMapping: Record<string, string>; // shape name → paper node id
}

export async function paperLoad({ projectDir, boardName }: PaperLoadOptions): Promise<PaperLoadResult> {
  const specPath = join(projectDir, "flow-spec.json");
  const spec = JSON.parse(await readFile(specPath, "utf8")) as FlowSpec;
  const board = spec.boards.find((b) => b.name === boardName);
  if (!board) throw new Error(`Board ${boardName} not in flow-spec`);

  const shapes = shapesFromSpec(spec, boardName);
  if (shapes.length === 0) throw new Error(`No shapes for board "${boardName}" in flow-spec`);

  const paper = await connect("paper");

  const artboardArgs = {
    name: `inkpot_${boardName}`,
    styles: { width: `${board.width}px`, height: `${board.height}px` },
  };
  const created = (await paper.call("create_artboard", artboardArgs)) as { id: string };
  const artboardId = created.id;

  // One shape at a time: each call creates exactly one tree whose root is createdNodes[0].
  // We rename that root to the shape name. This is the only reliable way to maintain a
  // shape-name → paper-node-id mapping given that Paper restructures bulk HTML.
  const shapeMapping: Record<string, string> = {};
  const updates: Array<{ nodeId: string; name: string }> = [];
  for (const shape of shapes) {
    const singleHtml = renderSingleShape(shape);
    const writeRes = (await paper.call("write_html", {
      targetNodeId: artboardId,
      mode: "insert-children",
      html: singleHtml,
    })) as { createdNodes: Array<{ id: string; name: string; component: string }> };

    const root = writeRes.createdNodes[0];
    if (!root) continue;
    shapeMapping[shape.name] = root.id;
    updates.push({ nodeId: root.id, name: shape.name });
  }
  if (updates.length > 0) {
    await paper.call("rename_nodes", { updates });
  }

  // Persist manifest for later sync.
  const manifestPath = join(projectDir, ".inkpot", `${boardName}.paper.json`);
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({ board: boardName, artboardId, shapeMapping }, null, 2),
  );

  return { artboardId, shapeMapping };
}

if (import.meta.main) {
  const [projectDir, boardName] = process.argv.slice(2);
  if (!projectDir || !boardName) {
    console.error("Usage: paper-load <project-dir> <board-name>");
    process.exit(1);
  }
  const result = await paperLoad({ projectDir, boardName });
  console.log(`paper-load: artboard ${result.artboardId} for board "${boardName}"`);
  console.log(`  mapped ${Object.keys(result.shapeMapping).length} shapes`);
}
