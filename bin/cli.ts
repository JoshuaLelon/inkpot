#!/usr/bin/env bun
// inkpot — turn a Penpot prototype into a polished Next.js app via Paper.

import { extractFlowSpec } from "../src/penpot-extract.js";
import { scaffold } from "../src/scaffold.js";
import { paperLoad } from "../src/paper-load.js";
import { paperSync } from "../src/paper-sync.js";
import { paperPolish } from "../src/paper-polish.js";
import { polishAll } from "../src/polish-all.js";
import { penpotBuild } from "../src/penpot-build.js";
import { lift } from "../src/lift.js";
import { connect } from "../src/mcp.js";
import type { FlowSpec } from "../src/types.js";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

interface CommandSpec {
  summary: string;
  usage: string;
  details: string;
  run: () => Promise<void>;
}

const sub = process.argv[2];
const args = process.argv.slice(3);

function flag(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

const TOPLEVEL_HELP = `inkpot — turn a Penpot prototype into a polished Next.js app via Paper.

The pipeline glues two design tools to a codebase. Penpot owns the flow (which
screens link, on what trigger). Paper owns the visuals. The codebase is the
deliverable. The shape-name contract holds across all three.

WORKFLOW (cold start to engineering handoff)

  mkdir myapp && cd myapp

  1. inkpot penpot-build "..."    Claude builds the wireframe in Penpot.
                                           Look at the Penpot tab. Click play to
                                           test. Re-run with tweaks until happy.
  2. inkpot penpot-extract        Penpot → flow-spec.json
  3. inkpot scaffold .            spec → Next.js app, runnable
     pnpm install
  4. inkpot polish-all . --brief  Claude polishes every screen via Paper.
                                           Re-run to iterate on a different brief.
  5. inkpot lift                  consolidate arbitrary values → globals.css
                                           @theme tokens + named JSX classes.
  6. pnpm dev / pnpm build                 verify in browser, build for handoff

PREREQS

  - Penpot MCP running     npx -y @penpot/mcp@latest      (terminal tab)
  - Penpot tab open        design.penpot.app, MCP plugin: ● Connected
  - Paper Desktop open     any file (Paper's MCP starts itself on :29979)
  - ANTHROPIC_API_KEY      in env (for the polish step)

COMMANDS

  doctor                   verify both MCPs are reachable
  penpot-build             spawn Claude with Penpot MCP, build/iterate the wireframe
  penpot-extract           Penpot active page → flow-spec.json
  scaffold                 flow-spec.json → Next.js app
  paper-load               send a single board's shapes to Paper as named layers
  paper-polish             spawn Claude with Paper MCP, polish one artboard
  paper-sync               read Paper styles back, update one board's page.tsx
  polish-all               loop paper-load → polish → sync over every board
  lift                     extract arbitrary Tailwind values into a globals.css
                           @theme; rewrite JSX to use named tokens
  walkthrough              full step-by-step runbook with example briefs
  help [command]           this overview, or full details for one command

For the full annotated runbook:  inkpot walkthrough
For details on any command:      inkpot help <command>
                            or:  inkpot <command> --help
`;

const WALKTHROUGH = `inkpot walkthrough — cold start to engineering handoff.

╭─ Background services (start once, leave running) ─────────────────────────────╮

  Terminal A — Penpot MCP server
    npx -y @penpot/mcp@latest

  Browser
    1. open https://design.penpot.app
    2. open a file (or create one)
    3. ⌘⌥P → Plugin Manager → install from URL: http://localhost:4400/manifest.json
    4. Open the plugin → "● Connect to MCP server" → DON'T close the panel
    5. Inside Penpot, create a new Page named after your project (Pages panel: +)
       Make sure that page is the ACTIVE page — penpot-build/extract operate on
       whatever's active.

  Paper Desktop
    Open Paper Desktop with any file. Paper's MCP starts itself on :29979.

╰───────────────────────────────────────────────────────────────────────────────╯

╭─ Per project ─────────────────────────────────────────────────────────────────╮

  mkdir ~/workspace/myapp && cd ~/workspace/myapp

  # Sanity check.
  inkpot doctor
  # → ✓ penpot, ✓ paper

  ── Wireframe phase: tell, look, tweak, approve ────────────────────────────────

  # 1. First-pass build. Claude drives Penpot via MCP. Watch the Penpot tab.
  inkpot penpot-build "3-screen onboarding for a fitness app: welcome,
    goal selection (3 goal cards), profile setup. CTA at the bottom of each
    screen advances. Last screen's CTA finishes onboarding."

  # 2. Look in your Penpot tab. Switch to the page. Click the play button (▶ top
  #    right) to test the prototype. If something's wrong, tell Claude to fix it:
  inkpot penpot-build "make the goal cards bigger; add icons to them.
    Also rename 'profile setup' to 'About you'."

  # 3. Iterate until the prototype feels right. Each call is cheap (~30 turns).

  ── Approve and extract ────────────────────────────────────────────────────────

  # 4. Pull the spec. The active Penpot page becomes flow-spec.json.
  inkpot penpot-extract

  # 5. Generate the Next.js skeleton from the spec.
  inkpot scaffold .
  pnpm install
  pnpm dev
  # localhost:3000 — clickable but ugly. Confirms the wiring works.

  ── Polish phase: tell, look, tweak, approve ───────────────────────────────────

  # 6. Polish all screens via Paper. Claude drives Paper via MCP per board.
  #    Brief sets the design direction.
  inkpot polish-all . --brief "calm editorial mood, single cobalt accent
    on white, Inter typography, restrained spacing"

  # 7. Reload localhost:3000. Look. If you want a different direction or need a
  #    board reworked:
  inkpot paper-polish . goal-selection --brief "make the goal cards
    more dramatic — bigger headlines, generous whitespace, hero photography mood"
  inkpot paper-sync . goal-selection

  # 8. Iterate until happy. Polish-all again with a different brief if you want a
  #    wholesale redesign.

  ── Lift to a real design system ───────────────────────────────────────────────

  # 9. Consolidate arbitrary values into named tokens.
  #    After this, app/globals.css IS the design system. Engineering edits one
  #    variable and every screen updates.
  inkpot lift .

  ── Hand off ───────────────────────────────────────────────────────────────────

  # 10. Build for engineering.
  pnpm build
  # Repo is ready. Commit and ship.

╰───────────────────────────────────────────────────────────────────────────────╯

╭─ How iteration works at every stage ──────────────────────────────────────────╮

  Phase            "Tell"                              "Look"             "Tweak"
  ─────────────────────────────────────────────────────────────────────────────
  Wireframe        penpot-build "..."                  Penpot tab → Play  re-run
  Polish all       polish-all . --brief "..."          localhost:3000     re-run
  Polish one       paper-polish . <board> --brief…     localhost:3000/<b> re-run
                   then paper-sync . <board>
  Lift             lift .                              app/globals.css    re-run
                                                       + JSX classNames

  Penpot iteration costs ~30 turns of Opus per call. Paper polish costs ~30 turns
  per board, but is gated by Paper's free-tier weekly cap on write_html and
  get_computed_styles — that's the practical limit on how often you can re-polish
  without Paper Pro. Lift is one Claude call total, idempotent: rerun safely after
  any further polish.

╰───────────────────────────────────────────────────────────────────────────────╯

╭─ When you forget what's available ────────────────────────────────────────────╮

  inkpot help                    workflow + command list
  inkpot help <command>          full details on any one command

╰───────────────────────────────────────────────────────────────────────────────╯
`;

const COMMANDS: Record<string, CommandSpec> = {
  doctor: {
    summary: "Inventory: which prerequisites are running, which aren't",
    usage: "inkpot doctor",
    details: `Runs every prerequisite check and reports a per-item status with a fix hint
when something's wrong. Run this first whenever something feels off.

WHAT IT CHECKS
  Penpot MCP server (:4401)        is the npx server up? lists its tools
  Penpot plugin connected           is the browser-side plugin tethered? probes
                                    via execute_code; reports the open file +
                                    active page name on success
  Paper MCP (:29979)                is the desktop app's MCP responding?
  Paper file open                   reports file name, page name, artboard count
  ANTHROPIC_API_KEY                 set in the current shell? (only required for
                                    penpot-build / paper-polish / polish-all /
                                    lift — the LLM-driven steps)

OUTPUT
  Each line: ✓ or ✗, the label, and a one-line detail.
  Failures get a "→ <fix>" line beneath them.
  Final line: "Ready: yes ✓" or "Ready: no — fix items marked ✗ above".

WALKTHROUGH INTEGRATION
  \`inkpot walkthrough\` runs these checks first, then prints the runbook.
  So before you start a project, walkthrough shows you exactly which
  prerequisites are missing.
`,
    run: cmdDoctor,
  },

  "penpot-build": {
    summary: "Build or iterate the Penpot wireframe from a brief",
    usage: "inkpot penpot-build '<brief>' [--model <id>] [--verbose]",
    details: `Spawns a Claude session via the Anthropic SDK with Penpot's MCP tools exposed.
Claude reads Penpot's plugin API guide, inspects the active page's current state,
then builds (or modifies, if state already exists) the wireframe to match the brief.

ARGS
  '<brief>'                Free-form description. First call: what to build.
                           Later calls: what to change. The agent treats it as
                           an iteration on whatever's already on the page.

OPTIONS
  --model <id>             Claude model id. Default: claude-opus-4-7 (latest, best
                           for design taste). Cheaper alternatives:
                             claude-sonnet-4-6     fast, good enough for wireframes
                             claude-haiku-4-5-20251001    cheapest, simpler tasks
  --verbose                stream turn-by-turn progress

PREREQS
  - Penpot tab open in browser, MCP plugin: ● Connected
  - The active page in Penpot is where Claude will work. Switch pages first if
    you want a clean slate (or use Penpot's Pages panel to make a new page).
  - ANTHROPIC_API_KEY in env

WHAT GETS BUILT
  - Boards (one per screen), 375×812 by default, named after their semantic role
  - Placeholder shapes (rectangles + text), low-fidelity, named after their role
  - Interactions wired via shape.addInteraction(trigger, action)
  - A flow registered via page.createFlow(name, startBoard)

THE NAMING CONTRACT
  The agent is heavily prompted to name shapes deliberately — those names ride
  the rest of the pipeline (data-shape= in JSX, layer name in Paper). If the
  brief implies new interactions, those need names too.

VERIFY
  Open the Penpot tab. Switch to the page you targeted. Use the Prototype tab
  / play button (top-right) to test the clickable prototype. Re-run penpot-build
  with feedback if anything's off. Iteration is cheap.

EXAMPLES
  inkpot penpot-build "3-screen onboarding for a fitness app: welcome,
    goal selection, profile setup. Each screen has a primary CTA at the bottom
    that advances. Last screen's CTA finishes onboarding."
  inkpot penpot-build "make the loginButton bigger; add a 'forgot password' link below it"
  inkpot penpot-build "add a 4th screen: notifications opt-in, between profile and done"

NEXT (when the wireframe looks right)
  inkpot penpot-extract
`,
    run: cmdPenpotBuild,
  },

  "penpot-extract": {
    summary: "Penpot active page → flow-spec.json",
    usage: "inkpot penpot-extract [--out <path>]",
    details: `Connects to the Penpot MCP and runs an introspection script in the plugin
context. Walks the *currently active page*, collects every board, every shape
on each board, and every prototype interaction. Writes a JSON spec.

OPTIONS
  --out <path>             output path (default ./flow-spec.json)

OUTPUT (flow-spec.json shape)
  {
    "boards":      [{ id, name, pageName, width, height }],
    "flows":       [{ name, startBoardName }],
    "interactions": [
      { fromBoardName, shapeName, trigger, action, bbox, ... }
    ],
    "boardShapes": {
      "<boardName>": [
        { id, name, type, bbox: {x,y,w,h}, textContent }
      ]
    }
  }

THE NAME CONTRACT
  Whatever you name shapes in Penpot rides the rest of the pipeline. A shape
  called "loginButton" becomes <div data-shape="loginButton"> in the scaffold
  and a layer named "loginButton" in Paper. The contract holds across re-runs.

NEXT
  inkpot scaffold .
`,
    run: cmdExtract,
  },

  scaffold: {
    summary: "flow-spec.json → Next.js app (Tailwind classNames, onClicks wired)",
    usage: "inkpot scaffold [<target-dir>] [--spec <path>]",
    details: `Generates a complete Next.js project from flow-spec.json. Bootstrap files
(package.json, tsconfig, postcss config, etc.) are only written if missing.
Per-board pages (app/<board>/page.tsx) are *always* overwritten — they're the
regenerable artifact.

ARGS
  <target-dir>             default: current directory
  --spec <path>            default: <target-dir>/flow-spec.json

WHAT GETS WRITTEN
  package.json, tsconfig.json, next.config.mjs, postcss.config.mjs   (once)
  app/layout.tsx, app/globals.css, .gitignore                        (once)
  app/page.tsx                                                       (always — redirects to start board)
  app/<board>/page.tsx                                               (always)
  flow-spec.json                                                     (copied/refreshed)

EACH PAGE
  - "use client" with useRouter
  - One <div data-shape="X"> per Penpot shape on the board
  - Layout via Tailwind v4 arbitrary values: left-[24px] top-[80px] w-[71px] h-[34px]
  - Interactive shapes become <button> with onClick handlers per the flow-spec
    (navigate-to → router.push, previous-screen → router.back, open-url → window.open)
  - No inline styles. Visuals come later from polish.

NEXT
  pnpm install
  inkpot polish-all . --brief "..."
`,
    run: cmdScaffold,
  },

  "paper-load": {
    summary: "Send a board's shapes to Paper as named layers",
    usage: "inkpot paper-load <project-dir> <board-name>",
    details: `Reads flow-spec.json, then for each shape on the board:
  1. write_html with a single <div> (one shape per call — Paper restructures
     bulk HTML unpredictably, but a single shape produces one node tree)
  2. rename_nodes on the root to apply the Penpot shape name

Writes a manifest at .inkpot/<board>.paper.json containing the shape-name →
Paper-node-id mapping. paper-sync uses this to know which node has the styles
for which JSX element.

ARGS
  <project-dir>            project root (must contain flow-spec.json)
  <board-name>             name of a board in flow-spec.json

WHY ONE CALL PER SHAPE
  Verified empirically: Paper's write_html does not preserve layer names from
  HTML attributes (data-name, aria-label, id, title, class are all ignored).
  And bulk HTML gets restructured into a hierarchy Paper picks. Per-shape calls
  + rename_nodes is the only reliable way to maintain the name contract.

NEXT
  inkpot paper-polish <project-dir> <board-name>
`,
    run: cmdPaperLoad,
  },

  "paper-polish": {
    summary: "Spawn Claude with Paper MCP, polish one artboard",
    usage: "inkpot paper-polish <project-dir> <board-name> [--brief '...'] [--model <id>] [--verbose]",
    details: `Spawns a Claude session via the Anthropic SDK with Paper's MCP tools exposed
as Anthropic tools. The system prompt enforces the name contract: Claude is
told never to rename or delete the named layers — only modify their styles
and child structure.

Claude reads Paper's own design guide, takes screenshots, plans, and uses
update_styles / write_html / set_text_content / etc. until it calls
finish_working_on_nodes or hits the turn budget (80).

ARGS
  <project-dir>            project root
  <board-name>             board name (must already be paper-loaded)

OPTIONS
  --brief '...'            design direction for this screen (palette, mood,
                           target audience). Free-form. Optional but recommended.
  --model <id>             Claude model id. Default: claude-opus-4-7 (latest, best
                           for visual taste). Cheaper alternatives:
                             claude-sonnet-4-6     fast, good for routine polish
                             claude-haiku-4-5-20251001    cheapest, simple tweaks
  --verbose                stream turn-by-turn progress

REQUIREMENTS
  ANTHROPIC_API_KEY in env.

KNOWN LIMITS
  Paper free tier weekly-caps write_html and get_computed_styles.
  Hit the limit, polish breaks. Wait for reset or upgrade to Paper Pro.

NEXT
  inkpot paper-sync <project-dir> <board-name>
`,
    run: cmdPaperPolish,
  },

  "paper-sync": {
    summary: "Read Paper styles back, update one board's page.tsx",
    usage: "inkpot paper-sync <project-dir> <board-name>",
    details: `Reads .inkpot/<board>.paper.json (the shape→node-id manifest), calls
get_computed_styles for every node, picks visual properties (color, type,
radius, shadow, etc. — never position; that's owned by Penpot), converts to
Tailwind v4 classes, and regenerates the className for each <div data-shape>
in app/<board>/page.tsx.

ARGS
  <project-dir>            project root
  <board-name>             board name (must have a paper-loaded artboard)

CLASSNAME REGENERATION
  layout classes        from flow-spec.json bbox  (always present)
  base classes          preserved structural things (flex, items-center, etc.)
  visual classes        from Paper computed styles
  Old "placeholder" visual classes (bg-zinc-*, text-zinc-*, rounded-*, etc)
  are stripped before the polished ones go in.

INVARIANTS PRESERVED
  - The element's text content (e.g. "Sign in")
  - onClick handlers and other JSX expressions
  - Position (left/top/width/height) — never overwritten by Paper

NEXT
  pnpm dev   # check it
  pnpm build # ship it
`,
    run: cmdPaperSync,
  },

  lift: {
    summary: "Extract arbitrary Tailwind values into a globals.css @theme; refactor JSX",
    usage: "inkpot lift [<project-dir>] [--model <id>] [--dry-run]",
    details: `After polish-all leaves the JSX full of arbitrary values like bg-[#1F3DD9] and
text-[16px], lift consolidates them into a real Tailwind v4 design system.

WHAT IT DOES
  1. Scans every app/<board>/page.tsx in the project.
  2. Extracts arbitrary values per category (color, font-size, font-family,
     radius, shadow, tracking, leading). Position values (left/top/width/height)
     are intentionally skipped — they're per-shape, not theme.
  3. Sends the inventory to Claude in one shot. Claude:
       - Names tokens semantically (canvas/ink/accent/mute, not color-1/2/3)
       - Consolidates near-duplicates (two slightly different blues → one)
       - Outputs a Tailwind v4 @theme block + class replacement map
  4. Writes app/globals.css preserving any @import and non-@theme content.
  5. Rewrites every page.tsx, swapping arbitrary values for named classes:
        bg-[#1F3DD9]   →  bg-accent
        text-[16px]    →  text-base
        rounded-[12px] →  rounded-md

ARGS
  <project-dir>      default: current directory

OPTIONS
  --model <id>       Claude model id (default: claude-opus-4-7)
  --dry-run          plan but don't write any files

WHEN TO RUN
  After polish-all completes (or after every iteration of it). Lift is safe to
  run repeatedly — it'll consolidate any new values added by subsequent polish.

OUTPUT
  app/globals.css                @theme block written
  app/<board>/page.tsx           rewritten in-place

EFFECT ON HANDOFF
  After lift, the codebase IS the design system. Engineering edits one variable
  in app/globals.css and every screen updates. No arbitrary values remain in
  the JSX.

REQUIREMENTS
  ANTHROPIC_API_KEY in env.
`,
    run: cmdLift,
  },

  walkthrough: {
    summary: "Full step-by-step runbook with example briefs",
    usage: "inkpot walkthrough",
    details: `Prints a complete annotated runbook covering:
  - Background services to start once (Penpot MCP, Penpot browser tab, Paper Desktop)
  - The per-project loop (mkdir, doctor, build, iterate, extract, scaffold, polish, ship)
  - The "tell / look / tweak / approve" iteration pattern at every stage
  - Where to look for help when you forget a command

Use this on a fresh project, or when handing the pipeline to someone (or some
LLM) for the first time.
`,
    run: cmdWalkthrough,
  },

  "polish-all": {
    summary: "Loop paper-load → polish → sync over every board",
    usage: "inkpot polish-all <project-dir> [options]",
    details: `Orchestration over a list of boards. Default is every board in flow-spec.json,
in order. Errors on one board don't stop the rest.

ARGS
  <project-dir>            project root

OPTIONS
  --brief '...'            design brief, passed to every polish step
  --only a,b,c             comma-separated subset of board names to process
  --model <id>             Claude model id (default: claude-opus-4-7)
  --skip-polish            run paper-load + paper-sync only (useful if you've
                           already polished and just need to re-sync, e.g. after
                           a Paper rate-limit reset)
  --skip-sync              run paper-load + polish only (preview without writing
                           back to JSX)
  --verbose                turn-by-turn polish output

OUTPUT
  Per-board summary at the end: loaded / turns / finished / synced / error.

EXAMPLES
  inkpot polish-all . --brief "calm editorial type, single accent"
  inkpot polish-all . --only login,dashboard --skip-polish
`,
    run: cmdPolishAll,
  },
};

// ---- command implementations ----

async function cmdPenpotBuild() {
  // First positional non-flag arg is the brief.
  // We need to skip the value of any flag that takes one (--model, --brief).
  const flagWithValue = new Set(["--model", "--brief"]);
  let brief: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith("--")) {
      if (flagWithValue.has(args[i]!)) i++; // skip value
      continue;
    }
    brief = args[i];
    break;
  }
  if (!brief) {
    console.error("Usage: inkpot penpot-build '<brief>' [--model <id>] [--verbose]\n");
    printHelp("penpot-build", true);
    return;
  }
  const modelIdx = args.indexOf("--model");
  const model = modelIdx !== -1 ? args[modelIdx + 1]! : undefined;
  const verbose = args.includes("--verbose");
  console.log(`penpot-build: Claude (${model ?? "claude-opus-4-7"}) is now driving Penpot. Watch the Penpot tab for the page being built.`);
  const result = await penpotBuild({ brief, model, verbose });
  console.log(`\npenpot-build: ${result.turns} turns`);
  if (result.finalAssistantText) console.log(`\n${result.finalAssistantText}`);
}

async function cmdExtract() {
  const out = flag("--out") ?? "flow-spec.json";
  const spec = await extractFlowSpec();
  const path = resolve(out);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(spec, null, 2));
  console.log(`penpot-extract: wrote ${path}`);
  console.log(`  boards: ${spec.boards.map((b) => b.name).join(", ")}`);
  console.log(`  flows: ${spec.flows.map((f) => f.name).join(", ")}`);
  console.log(`  interactions: ${spec.interactions.length}`);
}

async function cmdScaffold() {
  const targetDir = resolve(args[0] ?? ".");
  const specPath = flag("--spec") ?? `${targetDir}/flow-spec.json`;
  const spec = JSON.parse(await readFile(specPath, "utf8")) as FlowSpec;
  const result = await scaffold({ spec, targetDir });
  console.log(`scaffold: wrote ${result.pagesWritten.length} pages into ${targetDir}`);
}

async function cmdWalkthrough(): Promise<void> {
  console.log("inkpot walkthrough — current state of your environment\n");
  console.log("╭─ Checking prerequisites ──────────────────────────────────────────────────────╮\n");
  const checks = await runChecks();
  const ready = printChecks(checks);
  console.log("\n╰───────────────────────────────────────────────────────────────────────────────╯");
  if (!ready) {
    console.log("\nFix the items marked ✗ above before running the rest of the workflow.\n");
  }
  console.log(WALKTHROUGH);
}

interface CheckResult {
  ok: boolean;
  label: string;
  detail?: string;
  fix?: string;
}

async function runChecks(): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];

  // Penpot MCP server
  let penpot: Awaited<ReturnType<typeof connect>> | null = null;
  try {
    penpot = await connect("penpot");
    const tools = await penpot.tools();
    checks.push({ ok: true, label: "Penpot MCP server (:4401)", detail: `${tools.length} tools` });
  } catch (err) {
    checks.push({
      ok: false,
      label: "Penpot MCP server (:4401)",
      detail: (err as Error).message.split("\n")[0],
      fix: "run `npx -y @penpot/mcp@latest` in a terminal tab",
    });
  }

  // Penpot plugin connected (probed via execute_code returning current file/page)
  if (penpot) {
    try {
      const r = (await penpot.call("execute_code", {
        code: "return { file: penpot.currentFile?.name ?? null, page: penpot.currentPage?.name ?? null };",
      })) as { result: { file: string | null; page: string | null } };
      if (r.result.file) {
        checks.push({
          ok: true,
          label: "Penpot plugin connected",
          detail: `file: "${r.result.file}", active page: "${r.result.page ?? "<none>"}"`,
        });
      } else {
        checks.push({
          ok: false,
          label: "Penpot plugin connected",
          detail: "no current file",
          fix: "open a Penpot file in design.penpot.app",
        });
      }
    } catch (err) {
      checks.push({
        ok: false,
        label: "Penpot plugin connected",
        detail: (err as Error).message.split("\n")[0],
        fix: "open the MCP plugin panel in Penpot, click 'Connect to MCP server'",
      });
    }
  }

  // Paper MCP server
  let paper: Awaited<ReturnType<typeof connect>> | null = null;
  try {
    paper = await connect("paper");
    const tools = await paper.tools();
    checks.push({ ok: true, label: "Paper MCP (:29979)", detail: `${tools.length} tools` });
  } catch (err) {
    checks.push({
      ok: false,
      label: "Paper MCP (:29979)",
      detail: (err as Error).message.split("\n")[0],
      fix: "open Paper Desktop with a file",
    });
  }

  // Paper file open (probe via get_basic_info)
  if (paper) {
    try {
      const info = (await paper.call("get_basic_info", {})) as { fileName: string; pageName: string; artboardCount: number };
      checks.push({
        ok: true,
        label: "Paper file open",
        detail: `"${info.fileName}" / page "${info.pageName}", ${info.artboardCount} artboards`,
      });
    } catch (err) {
      checks.push({
        ok: false,
        label: "Paper file open",
        detail: (err as Error).message.split("\n")[0],
        fix: "open a file in Paper Desktop",
      });
    }
  }

  // ANTHROPIC_API_KEY (only required for the polish/build steps that spawn Claude)
  if (process.env.ANTHROPIC_API_KEY) {
    checks.push({ ok: true, label: "ANTHROPIC_API_KEY", detail: "set" });
  } else {
    checks.push({
      ok: false,
      label: "ANTHROPIC_API_KEY",
      detail: "not set",
      fix: "export ANTHROPIC_API_KEY=sk-... (only needed for penpot-build / paper-polish / polish-all)",
    });
  }

  return checks;
}

function printChecks(checks: CheckResult[]): boolean {
  const labelWidth = Math.max(...checks.map((c) => c.label.length));
  for (const c of checks) {
    const mark = c.ok ? "✓" : "✗";
    const padded = c.label.padEnd(labelWidth);
    console.log(`  ${mark} ${padded}  ${c.detail ?? ""}`);
    if (!c.ok && c.fix) console.log(`    → ${c.fix}`);
  }
  const allOk = checks.every((c) => c.ok);
  console.log(`\n  Ready: ${allOk ? "yes ✓" : "no — fix items marked ✗ above"}`);
  return allOk;
}

async function cmdDoctor() {
  const checks = await runChecks();
  printChecks(checks);
}

async function cmdPaperLoad() {
  const projectDir = resolve(args[0] ?? ".");
  const board = args[1];
  if (!board) return printHelp("paper-load", true);
  const result = await paperLoad({ projectDir, boardName: board });
  console.log(`paper-load: artboard ${result.artboardId} for board "${board}"`);
  console.log(`  mapped ${Object.keys(result.shapeMapping).length} shapes`);
  for (const [name, id] of Object.entries(result.shapeMapping)) {
    console.log(`    ${name} -> ${id}`);
  }
}

async function cmdPaperPolish() {
  const projectDir = resolve(args[0] ?? ".");
  const board = args[1];
  if (!board) return printHelp("paper-polish", true);
  const briefIdx = args.indexOf("--brief");
  const brief = briefIdx !== -1 ? args[briefIdx + 1]! : undefined;
  const modelIdx = args.indexOf("--model");
  const model = modelIdx !== -1 ? args[modelIdx + 1]! : undefined;
  const verbose = args.includes("--verbose");
  const result = await paperPolish({ projectDir, boardName: board, brief, model, verbose });
  console.log(`paper-polish: ${result.turns} turns, finished=${result.finished}`);
}

async function cmdPaperSync() {
  const projectDir = resolve(args[0] ?? ".");
  const board = args[1];
  if (!board) return printHelp("paper-sync", true);
  const result = await paperSync({ projectDir, boardName: board });
  console.log(`paper-sync: updated styles on ${result.updated}/${result.total} shapes`);
}

async function cmdLift() {
  const projectDir = resolve(args[0] ?? ".");
  const dryRun = args.includes("--dry-run");
  const modelIdx = args.indexOf("--model");
  const model = modelIdx !== -1 ? args[modelIdx + 1]! : undefined;
  const result = await lift({ projectDir, model, dryRun });
  console.log(`lift: scanned ${result.filesScanned} pages, found ${result.uniqueValues} unique values, planned ${result.replacementCount} replacements${dryRun ? " (dry-run)" : ""}`);
  if (result.notes) console.log(`  notes: ${result.notes}`);
  if (!dryRun && result.themeCssWritten) console.log(`  wrote: app/globals.css + ${result.filesScanned} page.tsx files`);
}

async function cmdPolishAll() {
  const projectDir = resolve(args[0] ?? ".");
  const briefIdx = args.indexOf("--brief");
  const brief = briefIdx !== -1 ? args[briefIdx + 1]! : undefined;
  const onlyIdx = args.indexOf("--only");
  const only = onlyIdx !== -1 ? args[onlyIdx + 1]!.split(",") : undefined;
  const modelIdx = args.indexOf("--model");
  const model = modelIdx !== -1 ? args[modelIdx + 1]! : undefined;
  const skipPolish = args.includes("--skip-polish");
  const skipSync = args.includes("--skip-sync");
  const verbose = args.includes("--verbose");
  const result = await polishAll({ projectDir, brief, model, only, skipPolish, skipSync, verbose });
  console.log("\nsummary:");
  for (const b of result.boards) {
    console.log(`  ${b.name}: loaded=${b.loaded} turns=${b.polishTurns} finished=${b.polishFinished} synced=${b.syncedShapes}${b.error ? ` ERR=${b.error}` : ""}`);
  }
}

function printHelp(name: string | undefined, fromError = false): void {
  if (!name) {
    console.log(TOPLEVEL_HELP);
    return;
  }
  const c = COMMANDS[name];
  if (!c) {
    console.error(`Unknown command: ${name}`);
    console.error(`Run \`inkpot help\` for the command list.`);
    process.exit(fromError ? 1 : 2);
  }
  console.log(`${name} — ${c.summary}\n`);
  console.log(`USAGE\n  ${c.usage}\n`);
  console.log(c.details);
  if (fromError) process.exit(1);
}

// ---- dispatch ----

if (!sub || sub === "help" || sub === "--help" || sub === "-h") {
  if (sub === "help" && args[0]) printHelp(args[0]);
  else printHelp(undefined);
  process.exit(0);
}

// Allow `<cmd> --help` / `<cmd> -h`
if (args[0] === "--help" || args[0] === "-h") {
  printHelp(sub);
  process.exit(0);
}

const cmd = COMMANDS[sub];
if (!cmd) {
  console.error(`Unknown command: ${sub}\n`);
  printHelp(undefined);
  process.exit(1);
}
await cmd.run();
