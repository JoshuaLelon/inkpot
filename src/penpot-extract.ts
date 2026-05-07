// Extract a FlowSpec from the currently-open Penpot file (whichever page is active).
// Run a single execute_code call that walks pages, boards, shapes, and interactions
// and returns a serialized graph.

import { connect } from "./mcp.js";
import type { FlowSpec } from "./types.js";

const EXTRACTOR = `
const file = penpot.currentFile;
if (!file) throw new Error("No file open in Penpot");

const boards = [];
const interactions = [];
const flows = [];
const boardShapes = {};

const targetPage = penpot.currentPage; // only the active page
if (!targetPage) throw new Error("No active page");

for (const flow of targetPage.flows ?? []) {
  flows.push({
    pageName: targetPage.name,
    name: flow.name,
    startBoardName: flow.startingBoard?.name ?? null,
  });
}

function walkShapes(node, into) {
  for (const child of (node.children ?? [])) {
    into.push(child);
    walkShapes(child, into);
  }
}

const allShapes = [];
walkShapes(targetPage.root, allShapes);

const boardNodes = allShapes.filter(s => s.type === "board");
for (const b of boardNodes) {
  boards.push({
    id: b.id,
    name: b.name,
    pageName: targetPage.name,
    width: b.width,
    height: b.height,
  });

  const boardChildren = [];
  walkShapes(b, boardChildren);
  boardShapes[b.name] = boardChildren.map(s => ({
    id: s.id,
    name: s.name,
    type: s.type,
    bbox: { x: s.x - b.x, y: s.y - b.y, w: s.width, h: s.height },
    textContent: s.type === "text" ? (s.characters || "") : undefined,
  }));
}

for (const shape of allShapes) {
  if (!(shape.interactions ?? []).length) continue;
  let parent = shape.parent;
  let owningBoard = null;
  while (parent) {
    if (parent.type === "board") { owningBoard = parent; break; }
    parent = parent.parent;
  }
  for (const ix of shape.interactions) {
    const action = ix.action;
    let serializedAction;
    switch (action?.type) {
      case "navigate-to":
        serializedAction = { type: "navigate-to", destinationBoardId: action.destination?.id, destinationBoardName: action.destination?.name };
        break;
      case "open-overlay":
      case "toggle-overlay":
        serializedAction = { type: action.type, overlayBoardId: action.overlay?.id, overlayBoardName: action.overlay?.name };
        break;
      case "close-overlay":
        serializedAction = { type: "close-overlay", overlayBoardId: action.overlay?.id, overlayBoardName: action.overlay?.name };
        break;
      case "previous-screen":
        serializedAction = { type: "previous-screen" };
        break;
      case "open-url":
        serializedAction = { type: "open-url", url: action.url };
        break;
      default:
        serializedAction = { type: action?.type ?? "unknown" };
    }
    const fromBoard = owningBoard;
    interactions.push({
      fromBoardId: fromBoard?.id ?? null,
      fromBoardName: fromBoard?.name ?? null,
      shapeId: shape.id,
      shapeName: shape.name,
      bbox: fromBoard
        ? { x: shape.x - fromBoard.x, y: shape.y - fromBoard.y, w: shape.width, h: shape.height }
        : { x: shape.x, y: shape.y, w: shape.width, h: shape.height },
      trigger: ix.trigger,
      delayMs: ix.delay ?? null,
      action: serializedAction,
    });
  }
}

return { boards, flows, interactions, boardShapes };
`;

export async function extractFlowSpec(): Promise<FlowSpec> {
  const penpot = await connect("penpot");
  const result = await penpot.call("execute_code", { code: EXTRACTOR });
  // result has shape { result: FlowSpec, log: string }
  const r = result as { result: FlowSpec };
  return r.result;
}

if (import.meta.main) {
  const spec = await extractFlowSpec();
  process.stdout.write(JSON.stringify(spec, null, 2) + "\n");
}
