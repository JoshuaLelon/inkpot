// Loop the full polish flow over every board: paper-load → paper-polish → paper-sync.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FlowSpec } from "./types.js";
import { paperLoad } from "./paper-load.js";
import { paperPolish } from "./paper-polish.js";
import { paperSync } from "./paper-sync.js";

export interface PolishAllOptions {
  projectDir: string;
  brief?: string;
  model?: string;
  verbose?: boolean;
  skipPolish?: boolean; // useful when Paper rate-limit hit
  skipSync?: boolean;
  only?: string[]; // limit to these boards
}

export interface PolishAllResult {
  boards: Array<{
    name: string;
    loaded: boolean;
    polishTurns: number;
    polishFinished: boolean;
    syncedShapes: number;
    error?: string;
  }>;
}

export async function polishAll(opts: PolishAllOptions): Promise<PolishAllResult> {
  const specPath = join(opts.projectDir, "flow-spec.json");
  const spec = JSON.parse(await readFile(specPath, "utf8")) as FlowSpec;

  const boardNames = (opts.only ?? spec.boards.map((b) => b.name)).filter((n) =>
    spec.boards.some((b) => b.name === n),
  );

  const result: PolishAllResult = { boards: [] };

  for (const name of boardNames) {
    const row: PolishAllResult["boards"][number] = {
      name,
      loaded: false,
      polishTurns: 0,
      polishFinished: false,
      syncedShapes: 0,
    };
    try {
      console.log(`\n=== ${name} ===`);
      const load = await paperLoad({ projectDir: opts.projectDir, boardName: name });
      row.loaded = true;
      console.log(`  loaded: ${Object.keys(load.shapeMapping).length} shapes mapped`);

      if (!opts.skipPolish) {
        const polish = await paperPolish({
          projectDir: opts.projectDir,
          boardName: name,
          brief: opts.brief,
          model: opts.model,
          verbose: opts.verbose,
        });
        row.polishTurns = polish.turns;
        row.polishFinished = polish.finished;
        console.log(`  polish: ${polish.turns} turns, finished=${polish.finished}`);
      }

      if (!opts.skipSync) {
        const sync = await paperSync({ projectDir: opts.projectDir, boardName: name });
        row.syncedShapes = sync.updated;
        console.log(`  sync: ${sync.updated}/${sync.total} shapes updated`);
      }
    } catch (err) {
      row.error = (err as Error).message;
      console.log(`  error: ${row.error}`);
    }
    result.boards.push(row);
  }

  return result;
}

if (import.meta.main) {
  const [projectDir, ...rest] = process.argv.slice(2);
  if (!projectDir) {
    console.error("Usage: polish-all <project-dir> [--brief '...'] [--only board1,board2] [--skip-polish] [--skip-sync] [--verbose]");
    process.exit(1);
  }
  const briefIdx = rest.indexOf("--brief");
  const brief = briefIdx !== -1 ? rest[briefIdx + 1]! : undefined;
  const onlyIdx = rest.indexOf("--only");
  const only = onlyIdx !== -1 ? rest[onlyIdx + 1]!.split(",") : undefined;
  const modelIdx = rest.indexOf("--model");
  const model = modelIdx !== -1 ? rest[modelIdx + 1]! : undefined;
  const skipPolish = rest.includes("--skip-polish");
  const skipSync = rest.includes("--skip-sync");
  const verbose = rest.includes("--verbose");
  const result = await polishAll({ projectDir, brief, model, only, skipPolish, skipSync, verbose });
  console.log("\nsummary:");
  for (const b of result.boards) {
    console.log(`  ${b.name}: loaded=${b.loaded} turns=${b.polishTurns} finished=${b.polishFinished} synced=${b.syncedShapes}${b.error ? ` ERR=${b.error}` : ""}`);
  }
}
