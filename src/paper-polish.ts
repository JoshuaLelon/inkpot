// Drive Paper to polish a pre-loaded artboard, using Claude as the design agent.
//
// We spawn an Anthropic SDK client, expose Paper's MCP tools to it, give it Paper's own
// design guide as system context, and let it iterate (write_html, update_styles,
// get_screenshot to verify) until it calls finish_working_on_nodes or hits a turn budget.

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  Tool as AnthropicTool,
  ContentBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { connect } from "./mcp.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

interface Manifest {
  board: string;
  artboardId: string;
  shapeMapping: Record<string, string>;
}

const SYSTEM = `You are a senior product designer using Paper, a professional design tool. You drive Paper through MCP tools to polish a wireframe-quality artboard into a finished design.

Hard rules for this session:
- The artboard's existing layer names (e.g. "title", "loginButton", "tabBar") are a contract. NEVER rename, delete, or reparent those layers — change only their styles, fills, typography, child structure if you must, but the named layers must remain identifiable by name and node ID.
- Use update_styles aggressively. Use write_html only to add new visual content INSIDE existing named layers, not at the artboard root.
- Take a get_screenshot every few changes and assess against your own quality checklist.
- When the design is polished, call finish_working_on_nodes with the artboard's node ID.

Your design philosophy comes from Paper's guide. Read it once at the start (get_guide topic="paper-mcp-instructions") and follow it.`;

const MAX_TURNS = 80;

function blockText(b: ContentBlock): string {
  if (b.type === "text") return b.text;
  return "";
}

export interface PolishOptions {
  projectDir: string;
  boardName: string;
  brief?: string;
  model?: string;
  verbose?: boolean;
}

export interface PolishResult {
  turns: number;
  finished: boolean;
  finalAssistantText: string;
}

export async function paperPolish({ projectDir, boardName, brief, model, verbose }: PolishOptions): Promise<PolishResult> {
  const manifestPath = join(projectDir, ".inkpot", `${boardName}.paper.json`);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

  const paper = await connect("paper");
  const mcpTools = await paper.tools();

  // Translate MCP tool definitions to Anthropic tool definitions.
  const tools: AnthropicTool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as AnthropicTool["input_schema"],
  }));

  // Brief tells Claude what to focus on.
  const namedLayers = Object.entries(manifest.shapeMapping)
    .map(([name, id]) => `  - ${name} (id: ${id})`)
    .join("\n");

  const userPrompt = `Polish the Paper artboard with id ${manifest.artboardId} (board: "${manifest.board}").

The artboard has these named layers — preserve every name and id, modify only visuals:
${namedLayers}

${brief ?? "Aim for a polished, professional mobile app design. Use a coherent color palette, real typography, and considered spacing. Treat this as a hero design that should feel timeless, not trendy."}

Begin by reading Paper's design guide and screenshotting the artboard's current state, then plan and apply polish. Call finish_working_on_nodes when done.`;

  const client = new Anthropic();
  const messages: MessageParam[] = [{ role: "user", content: userPrompt }];

  let turn = 0;
  let finished = false;
  let finalAssistantText = "";

  while (turn < MAX_TURNS) {
    turn++;
    const response: Message = await client.messages.create({
      model: model ?? "claude-opus-4-7",
      max_tokens: 8192,
      system: SYSTEM,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (verbose) {
      const text = response.content.map(blockText).filter(Boolean).join(" ");
      const toolCalls = response.content.filter((b) => b.type === "tool_use").map((b) => (b as { name: string }).name);
      console.error(`[turn ${turn}] stop=${response.stop_reason} text="${text.slice(0, 120)}" tools=[${toolCalls.join(",")}]`);
    }

    finalAssistantText = response.content.map(blockText).filter(Boolean).join("\n");

    if (response.stop_reason === "end_turn") {
      break;
    }
    if (response.stop_reason !== "tool_use") {
      break;
    }

    // Execute tool calls.
    const toolResults: ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      try {
        const result = await paper.call(block.name, block.input as Record<string, unknown>);
        if (block.name === "finish_working_on_nodes") {
          finished = true;
        }
        const content = typeof result === "string" ? result : JSON.stringify(result);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: content.length > 4000 ? content.slice(0, 4000) + "...[truncated]" : content,
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
    if (finished) break;
  }

  return { turns: turn, finished, finalAssistantText };
}

if (import.meta.main) {
  const [projectDir, boardName, ...rest] = process.argv.slice(2);
  if (!projectDir || !boardName) {
    console.error("Usage: paper-polish <project-dir> <board-name> [--brief '...'] [--verbose]");
    process.exit(1);
  }
  const briefIdx = rest.indexOf("--brief");
  const brief = briefIdx !== -1 ? rest[briefIdx + 1] : undefined;
  const verbose = rest.includes("--verbose");
  const result = await paperPolish({ projectDir, boardName, brief, verbose });
  console.log(`paper-polish: ${result.turns} turns, finished=${result.finished}`);
  if (result.finalAssistantText) console.log(result.finalAssistantText);
}
