# inkpot

A reusable pipeline that turns a Penpot prototype into a production-ready Next.js app, with Paper applying visual polish in between. You drive an LLM agent through three stages — wireframe (Penpot), polish (Paper), lift (Tailwind v4 design tokens) — and end with a runnable repo to hand to engineering.

## Why Paper for polish (not just "LLM, make it pretty")

Routing polish through [Paper](https://paper.design) gives the LLM a visual feedback loop: it can `get_screenshot` after every change, evaluate against Paper's design checklist, and iterate. Without that, an LLM editing JSX is picking CSS values blind — it can't see overlaps, cramped spacing, or wrap issues until someone runs the app. The cost is Paper Desktop + a weekly free-tier MCP limit + ~30 turns of Opus per board, in exchange for polish that approaches real design craft. Cheap aesthetic tweaks don't need this; finished-looking screens do.

## Prerequisites

Software:

- **macOS or Linux** (tested on macOS; Linux should work, untested)
- **[Bun](https://bun.com)** ≥ 1.3 — runs the CLI directly from TypeScript
- **Node.js** ≥ 22 (only because Penpot's MCP server runs on Node; Bun runs the inkpot CLI itself)
- **[Paper Desktop](https://paper.design/download)** — required for the polish stage; free tier works but caps weekly `write_html` / `get_computed_styles` calls
- **A [Penpot](https://design.penpot.app) account** — free, hosted; or self-hosted Penpot ≥ 2.14

Credentials:

- **`ANTHROPIC_API_KEY`** in your shell — required for the LLM-driven steps (`penpot-build`, `paper-polish`, `polish-all`, `lift`). Get one at [console.anthropic.com](https://console.anthropic.com). Plan on a few dollars per project for full polish on Opus 4.7; lower with `--model claude-sonnet-4-6`.

Optional but recommended:

- **`pnpm`** for installing the generated Next.js app's dependencies (you can use npm/yarn instead)

## Installation

```bash
# Clone
git clone https://github.com/JoshuaLelon/inkpot.git
cd inkpot

# Install dependencies (Bun reads bun.lock)
bun install

# Symlink the CLI onto your PATH
mkdir -p ~/.local/bin
ln -s "$PWD/bin/cli.ts" ~/.local/bin/inkpot
# Make sure ~/.local/bin is on PATH (add to ~/.zshrc / ~/.bashrc if not):
#   export PATH="$HOME/.local/bin:$PATH"

# Verify
inkpot help
```

That gives you `inkpot` as a global command. The CLI is a TypeScript file with a `#!/usr/bin/env bun` shebang, so it runs directly with no build step.

## First-time environment setup

Three background services must be running before any inkpot command that touches Penpot or Paper:

```bash
# 1. Start the Penpot MCP server (leave running in a terminal tab)
npx -y @penpot/mcp@latest

# 2. Open Penpot in your browser, install the MCP plugin (one-time per Penpot account):
#    a. https://design.penpot.app → open or create a file
#    b. ⌘⌥P (Cmd+Option+P) to open Plugin Manager — only works inside a file editor
#    c. Paste this URL: http://localhost:4400/manifest.json → Install
#    d. Open the plugin from the toolbar → click "Connect to MCP server"
#    e. Don't close the plugin panel — closing it kills the WebSocket
#    f. Create a new Page (Pages panel: +) for your project; this becomes the
#       active page that penpot-build/extract operate on

# 3. Open Paper Desktop with any file. Paper's MCP starts itself on :29979.

# 4. Set your Anthropic key in this shell (or in your shell rc file):
export ANTHROPIC_API_KEY=sk-ant-...

# 5. Sanity check
inkpot doctor
# Should report 5 ✓ marks and "Ready: yes ✓"
```

If any line shows ✗, the doctor output tells you what to fix.

## Mental model

| Tool | Role |
|---|---|
| **Penpot** | Source of truth for the *flow*: which screens exist and how they link. Shape names per screen are the contract that the rest of the pipeline carries through. |
| **Paper** | Visual polish service — driven via MCP, never opened by hand. |
| **The codebase** | Source of truth for the *deliverable*. Polished JSX lives here. Re-runs of the pipeline edit it in place. |

## The shape-name contract

Each Penpot board produces one route. Each named shape on a Penpot board becomes a `<div data-shape="X">` in the route's `page.tsx`. The Paper-load step recreates each shape as a named layer in Paper, polish modifies styles, and Paper-sync writes the polished CSS back to the matching `data-shape` element.

Names ride through the entire pipeline. Engineering finds them in the JSX.

## Commands

```
inkpot doctor                       both MCPs reachable?

inkpot penpot-build '<brief>'       spawn Claude with Penpot MCP,
                                             build or iterate the wireframe
                                             on the active page

inkpot penpot-extract [--out path]  read connected Penpot file's active page
                                             → flow-spec.json

inkpot scaffold [target-dir]        flow-spec.json → Next.js app
                                             routes, onClick handlers, ugly placeholder UI

inkpot paper-load <project> <board>
                                             read board's page.tsx
                                             → Paper artboard with named layers

# (polish step — see below)

inkpot paper-sync <project> <board>
                                             read polished Paper artboard styles
                                             → regenerate className with Tailwind v4 classes
                                             (layout from spec + visuals from Paper)
                                             preserves text content + onClick handlers

inkpot polish-all <project> [--brief '...'] [--only a,b]
                                                     [--skip-polish] [--skip-sync]
                                             loop paper-load → polish → paper-sync
                                             over every board (or just --only=a,b)

inkpot lift [<project>] [--model <id>] [--dry-run]
                                             extract arbitrary Tailwind values into
                                             app/globals.css @theme tokens; rewrite
                                             every page.tsx to use named classes
                                             (bg-[#1F3DD9] → bg-accent, etc.)
```

## Polish step

```
inkpot paper-polish <project> <board> [--brief '...'] [--verbose]
```

Spawns a Claude session via the Anthropic SDK with Paper's MCP tools exposed. Claude reads Paper's design guide, takes screenshots, plans, and applies polish (update_styles, write_html, set_text_content, etc.) until it calls `finish_working_on_nodes` or hits a turn budget (80).

System prompt enforces the name contract: Claude is told never to rename, delete, or reparent the named layers — only modify their styles and add child structure.

Requires `ANTHROPIC_API_KEY` in env. Default model: `claude-opus-4-7` (latest Opus, best for design taste). Override with `--model <id>` — e.g. `claude-sonnet-4-6` for cheaper routine iteration.

### Rate limits

**Paper Desktop free tier has a weekly cap on `write_html` and `get_computed_styles` MCP calls.** Hit it during testing of this pipeline. When the limit is reached, polish and sync will error out until reset (or a Paper Pro upgrade). Read-only tools without that quota (get_basic_info, get_node_info, get_tree_summary) still work.

If you're going to run this pipeline often, Paper Pro is required. Otherwise, save MCP calls for the boards you actually want polished.

### Manual polish alternative

If you don't want to spend Anthropic tokens (or hit Paper's MCP cap):

1. Open Paper Desktop, find the `inkpot_<board>` artboard.
2. Polish manually using the canvas.
3. Run `paper-sync` to bring styles back.

## Typical flow

```bash
# Start fresh: make a directory, move into it.
mkdir ~/workspace/myapp && cd ~/workspace/myapp

# Make sure both MCP backends are alive.
inkpot doctor

# Build (or iterate) the Penpot wireframe from a brief. Repeat until happy.
# Verify in the Penpot browser tab — switch to the active page, hit Play.
inkpot penpot-build "3-screen onboarding for a fitness app: welcome → goal selection → profile setup. Primary CTA at the bottom of each screen advances."
inkpot penpot-build "tweak: rename 'profile setup' to 'About you', and add a 'Skip' link in the top-right of that screen"

# Once the wireframe is approved, extract the spec.
inkpot penpot-extract

# Generate the Next.js app from the spec.
inkpot scaffold .
pnpm install

# (The skeleton at this point is runnable and clickable: pnpm dev → localhost:3000)

# Polish every board in one shot (or use --only board1,board2):
inkpot polish-all . --brief "your design brief here"

# Or polish individual boards:
inkpot paper-load . <board>
inkpot paper-polish . <board> --brief "your design brief here"
inkpot paper-sync . <board>

# Consolidate arbitrary Tailwind values into a real design system.
# After this, app/globals.css IS the source of truth for tokens.
inkpot lift .

# Build for engineering handoff.
pnpm build
```

## What ships to engineering

The deliverable is the project repo itself:

- `app/<board>/page.tsx` — one route per Penpot screen, with onClicks wired per the flow.
- `app/globals.css` — `@theme` block with the lifted design tokens (colors, type, radii, shadows). After `inkpot lift`, this is the source of truth for the design system.
- `flow-spec.json` — machine-readable record of the spec (in case engineering wants to regenerate).
- `.inkpot/<board>.paper.json` — manifest mapping shape names to Paper node IDs (helps re-runs).
- `package.json`, `tsconfig.json`, etc.

Engineering's job from there: edit tokens in `globals.css` if the brand evolves, wire real data fetching, add validation. The flow, visuals, and design system are already done.

## Design choices and known sharp edges

- **Position is owned by Penpot.** `paper-sync` preserves `left`/`top`/`width`/`height` from the scaffold (which came from Penpot bbox). Paper polish only contributes color, typography, radius, shadow, etc.
- **One write_html call per shape during paper-load.** Bulk write_html lets Paper restructure the hierarchy unpredictably; per-shape calls keep the name mapping reliable.
- **Layer names in Paper are set explicitly via rename_nodes.** Paper does not derive layer names from HTML attributes (verified — `data-name`, `aria-label`, `id`, `title`, class are all ignored).
- **Paper's get_jsx is not used.** It strips layer names. We use `get_computed_styles` per known node id instead.
- **`lift` runs after polish, not before.** The codebase IS the design system. Tokens emerge from what was actually built rather than being predicted up front. Idempotent — safe to re-run after every polish iteration.
- **The scaffold writes Tailwind v4 classes (arbitrary values pre-lift; named tokens post-lift).** No inline styles. Layout values (left/top/width/height) use arbitrary-value syntax like `left-[24px]` and stay arbitrary even after lift, since they're per-shape positions, not theme-worthy.

## File layout

```
inkpot/
├── bin/cli.ts                CLI entry point (subcommand dispatch)
├── src/
│   ├── mcp.ts                MCP client (HTTP transport, sessions)
│   ├── types.ts              FlowSpec types
│   ├── css-to-tailwind.ts    CSSProperties → Tailwind v4 classes (arbitrary values)
│   ├── penpot-extract.ts     Stage 1: read Penpot → flow-spec.json
│   ├── scaffold.ts           Stage 2: spec → Next.js skeleton (Tailwind classes only)
│   ├── penpot-build.ts       Stage 1a: spawn Claude w/ Penpot MCP → wireframe
│   ├── paper-load.ts         Stage 3a: spec → Paper artboard (named layers)
│   ├── paper-polish.ts       Stage 3b: spawn Claude w/ Paper MCP → polish
│   ├── paper-sync.ts         Stage 3c: Paper styles → JSX (regenerate className)
│   ├── polish-all.ts         Loop 3a/b/c over every board
│   └── lift.ts               Stage 4: arbitrary values → globals.css @theme
└── package.json
```

## Contributing

Issues and PRs welcome. The codebase is small, ~1k lines of TypeScript across `bin/cli.ts` and `src/*.ts`. To run from a clone:

```bash
bun install
bun bin/cli.ts help            # or: ./bin/cli.ts help (the shebang handles bun)
bun --bun tsc --noEmit         # typecheck
```

When adding a new pipeline stage:

1. Put the implementation in `src/<stage>.ts` with a clean exported function and an `import.meta.main` block for direct invocation.
2. Wire it into `bin/cli.ts`: import, add a `cmd<Stage>()` function, register an entry in the `COMMANDS` table with `summary` / `usage` / `details` text. The help system is data-driven from that table.
3. Update the `WALKTHROUGH` template if it changes the flow.

## License

MIT — see [LICENSE](./LICENSE).
