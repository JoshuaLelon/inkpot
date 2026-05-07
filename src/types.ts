// Flow spec — the contract Penpot produces and the scaffold/polish steps consume.

export type Trigger = "click" | "mouse-enter" | "mouse-leave" | "after-delay";

export type Action =
  | { type: "navigate-to"; destinationBoardId?: string; destinationBoardName: string }
  | { type: "open-overlay"; overlayBoardId?: string; overlayBoardName: string }
  | { type: "toggle-overlay"; overlayBoardId?: string; overlayBoardName: string }
  | { type: "close-overlay"; overlayBoardId?: string; overlayBoardName: string }
  | { type: "previous-screen" }
  | { type: "open-url"; url: string }
  | { type: "unknown" };

export interface Board {
  id: string;
  name: string;
  pageName: string;
  width: number;
  height: number;
}

export interface Flow {
  pageName: string;
  name: string;
  startBoardName: string | null;
}

export interface Shape {
  id: string;
  name: string;
  type: string;
  bbox: { x: number; y: number; w: number; h: number };
  textContent?: string;
}

export interface Interaction {
  fromBoardId: string | null;
  fromBoardName: string | null;
  shapeId: string;
  shapeName: string;
  bbox: { x: number; y: number; w: number; h: number };
  trigger: Trigger;
  delayMs: number | null;
  action: Action;
}

export interface FlowSpec {
  boards: Board[];
  flows: Flow[];
  interactions: Interaction[];
  // Per-board structural detail — useful for the scaffold to lay out placeholder content.
  boardShapes: Record<string, Shape[]>;
}
