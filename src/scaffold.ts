// Generate a Next.js app from a FlowSpec.
//
// Output layout (relative to targetDir):
//   package.json, tsconfig.json, next.config.mjs, postcss.config.mjs
//   app/layout.tsx, app/globals.css, app/page.tsx
//   app/<board>/page.tsx           one per board, ugly placeholder
//
// Each page:
//   - is a client component using useRouter
//   - has a flex container at the board's dimensions
//   - has one <div data-shape="X"> per Penpot shape, absolutely positioned at the Penpot bbox
//   - interactive shapes become <button> with onClick wired per the FlowSpec's interactions
//
// data-shape is the contract the polish step uses to apply Paper's polished styles
// back to the right element without rewriting the JSX structure.

import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { FlowSpec, Interaction, Shape } from "./types.js";
import { cssToTailwind } from "./css-to-tailwind.js";

async function ensureFile(path: string, content: string, force = false) {
  await mkdir(dirname(path), { recursive: true });
  if (!force) {
    try {
      await access(path);
      return; // already exists; don't clobber bootstrap files
    } catch {
      /* file doesn't exist; write it */
    }
  }
  await writeFile(path, content, "utf8");
}

const PACKAGE_JSON = (name: string) => `{
  "name": "${name}",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "15.1.3",
    "react": "19.0.0",
    "react-dom": "19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.2.4",
    "@types/node": "22.10.2",
    "@types/react": "19.0.2",
    "@types/react-dom": "19.0.2",
    "tailwindcss": "4.2.4",
    "typescript": "5.7.2"
  }
}
`;

const TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "app/**/*.ts", "app/**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
`;

const NEXT_CONFIG = `/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
`;

const POSTCSS_CONFIG = `export default {
  plugins: { "@tailwindcss/postcss": {} },
};
`;

const GLOBALS_CSS = `@import "tailwindcss";

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
button { font-family: inherit; font-size: inherit; cursor: pointer; }
`;

const ROOT_LAYOUT = `import "./globals.css";

export const metadata = { title: "Prototype" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

const ROOT_PAGE = (start: string) => `import { redirect } from "next/navigation";

export default function RootPage() {
  redirect("/${start}");
}
`;

const GITIGNORE = `node_modules
.next
.env*.local
*.tsbuildinfo
next-env.d.ts
`;

function inferDestinationRoute(action: Interaction["action"]): string | null {
  switch (action.type) {
    case "navigate-to":
      return `/${action.destinationBoardName}`;
    case "previous-screen":
      return "back";
    case "open-url":
      return `url:${action.url}`;
    default:
      return null;
  }
}

function shapeIsInteractive(shape: Shape, interactions: Interaction[]): Interaction | undefined {
  return interactions.find((ix) => ix.shapeId === shape.id);
}

// Build the baseline Tailwind classes for a shape's *layout* — no visuals, just position/size.
// Sync layers visual classes on top of these later, regenerating the full className string.
export function shapeLayoutClasses(shape: Shape): string[] {
  const { classes } = cssToTailwind({
    position: "absolute",
    left: shape.bbox.x,
    top: shape.bbox.y,
    width: shape.bbox.w,
    height: shape.bbox.h,
  });
  return classes;
}

const PLACEHOLDER_VISUAL_BY_TYPE: Record<string, string[]> = {
  rectangle: ["bg-zinc-200", "rounded-[4px]"],
  text: ["text-[14px]", "text-[#0A0A0A]"],
};

const PLACEHOLDER_BUTTON_VISUAL = ["bg-zinc-100", "text-[#3F3F46]", "text-[13px]", "rounded-[6px]", "border-0", "cursor-pointer"];

// Each named shape becomes an absolutely-positioned sibling. Buttons are emitted
// before their decorative labels, so the labels stack on top and would swallow
// clicks. Marking non-interactive shapes click-transparent lets the click reach
// the button underneath. paper-sync preserves this class (not in its strip list).
const NON_INTERACTIVE_BASE = ["pointer-events-none"];

function renderShape(shape: Shape, interactions: Interaction[]): string {
  const ix = shapeIsInteractive(shape, interactions);
  const dest = ix ? inferDestinationRoute(ix.action) : null;

  const safeName = JSON.stringify(shape.name);
  const text = shape.textContent ?? "";
  const layout = shapeLayoutClasses(shape);

  if (ix) {
    let onClick: string;
    if (dest === "back") onClick = "() => router.back()";
    else if (dest?.startsWith("url:")) onClick = `() => window.open(${JSON.stringify(dest.slice(4))}, "_blank", "noopener,noreferrer")`;
    else if (dest) onClick = `() => router.push(${JSON.stringify(dest)})`;
    else onClick = "() => {}";
    const cls = [...layout, ...PLACEHOLDER_BUTTON_VISUAL, "flex", "items-center", "justify-center"].join(" ");
    return `      <button data-shape={${safeName}} onClick={${onClick}} className="${cls}">${escapeJsxText(text || shape.name)}</button>`;
  }

  if (shape.type === "text") {
    const cls = [...layout, ...NON_INTERACTIVE_BASE, ...(PLACEHOLDER_VISUAL_BY_TYPE.text ?? [])].join(" ");
    return `      <div data-shape={${safeName}} className="${cls}">${escapeJsxText(text)}</div>`;
  }

  const cls = [...layout, ...NON_INTERACTIVE_BASE, ...(PLACEHOLDER_VISUAL_BY_TYPE.rectangle ?? [])].join(" ");
  return `      <div data-shape={${safeName}} className="${cls}" />`;
}

function escapeJsxText(s: string): string {
  return s.replace(/[<>{}]/g, (c) => `{${JSON.stringify(c)}}`);
}

function renderPage(boardName: string, board: { width: number; height: number }, shapes: Shape[], interactions: Interaction[]): string {
  const interactionsForBoard = interactions.filter((ix) => ix.fromBoardName === boardName);
  const body = shapes.map((s) => renderShape(s, interactionsForBoard)).join("\n");

  return `"use client";

import { useRouter } from "next/navigation";

export default function ${pascalCase(boardName)}Page() {
  const router = useRouter();
  return (
    <main className="grid place-items-center min-h-screen bg-zinc-950">
      <div className="relative bg-white shadow-2xl rounded-3xl overflow-hidden w-[${Math.round(board.width)}px] h-[${Math.round(board.height)}px]">
${body}
      </div>
    </main>
  );
}
`;
}

function pascalCase(s: string): string {
  return s.replace(/(^|[-_\s]+)(\w)/g, (_, __, ch: string) => ch.toUpperCase()).replace(/\W/g, "");
}

export interface ScaffoldOptions {
  spec: FlowSpec;
  targetDir: string;
  projectName?: string;
}

export async function scaffold({ spec, targetDir, projectName }: ScaffoldOptions): Promise<{ pagesWritten: string[] }> {
  const name = projectName ?? targetDir.split("/").pop() ?? "prototype";

  // Bootstrap files (only written if missing).
  await ensureFile(join(targetDir, "package.json"), PACKAGE_JSON(name));
  await ensureFile(join(targetDir, "tsconfig.json"), TSCONFIG);
  await ensureFile(join(targetDir, "next.config.mjs"), NEXT_CONFIG);
  await ensureFile(join(targetDir, "postcss.config.mjs"), POSTCSS_CONFIG);
  await ensureFile(join(targetDir, ".gitignore"), GITIGNORE);
  await ensureFile(join(targetDir, "app", "globals.css"), GLOBALS_CSS);
  await ensureFile(join(targetDir, "app", "layout.tsx"), ROOT_LAYOUT);

  // Root index page redirects to the start board.
  const startBoard = spec.flows[0]?.startBoardName ?? spec.boards[0]?.name;
  if (startBoard) {
    await ensureFile(join(targetDir, "app", "page.tsx"), ROOT_PAGE(startBoard), /*force=*/ true);
  }

  // Always overwrite the per-board pages (these are the regenerable artifact).
  const pagesWritten: string[] = [];
  for (const board of spec.boards) {
    const shapes = spec.boardShapes[board.name] ?? [];
    const content = renderPage(board.name, board, shapes, spec.interactions);
    const path = join(targetDir, "app", board.name, "page.tsx");
    await ensureFile(path, content, /*force=*/ true);
    pagesWritten.push(path);
  }

  // Also save the spec into the project for later steps.
  await ensureFile(join(targetDir, "flow-spec.json"), JSON.stringify(spec, null, 2), /*force=*/ true);

  return { pagesWritten };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const targetDir = args[0];
  if (!targetDir) {
    console.error("Usage: scaffold <target-dir> [--spec <path>]");
    process.exit(1);
  }
  const specPath = args[args.indexOf("--spec") + 1] || join(targetDir, "flow-spec.json");
  const spec = JSON.parse(await readFile(specPath, "utf8")) as FlowSpec;
  const result = await scaffold({ spec, targetDir });
  console.log(`scaffold: wrote ${result.pagesWritten.length} pages`);
  for (const p of result.pagesWritten) console.log(`  ${p}`);
}
