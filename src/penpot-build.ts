// Drive Penpot to build (or modify) a wireframe prototype, using Claude as the agent.
//
// Same shape as paper-polish.ts but for Penpot's MCP. Spawns a Claude session,
// exposes Penpot's tools (execute_code, export_shape, etc.), gives it a brief,
// and lets it iterate until it's done.
//
// Idempotent w.r.t. brief: if the active page is empty it builds from scratch;
// if it already has boards, the agent treats this call as an iteration on the
// existing prototype based on the brief.

import Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageParam,
  Tool as AnthropicTool,
  ContentBlock,
  ToolResultBlockParam,
} from "@anthropic-ai/sdk/resources/messages";
import { connect } from "./mcp.js";

const SYSTEM = `You are a senior product designer building (or modifying) a low-fidelity wireframe prototype in Penpot via its MCP tools.

Your single most important job is the NAMING CONTRACT. Every interactive shape must be named after its role (e.g. "loginButton", "signupLink", "tab_home"). Boards (screens) must be named after their semantic role (e.g. "login", "dashboard"). These names ride the rest of the pipeline — Paper polishes them later, engineering wires them up. Sloppy names break the pipeline.

What to build:
- One Board per screen, sized 375×812 (mobile) unless the brief specifies otherwise.
- Place a few rough placeholder shapes per screen — rectangles and text. Name them deliberately.
- Wire interactions: shape.addInteraction(trigger, action). Register the main flow via page.createFlow(name, startBoard).
- Don't waste tokens on visual polish (no fancy fills, gradients, shadows). Paper handles that later. White boards, gray placeholder rectangles, dark text. That's the bar.

How to use the tools:
- Call high_level_overview ONCE per session to refresh on the Penpot Plugin API surface.
- Call execute_code to discover current state and to make changes. The 'storage' object persists across calls — useful for keeping references to created boards.
- Call export_shape (PNG) on each board after building to verify visually before declaring done.
- For iteration: the active page may already have content. Call execute_code first to read currentPage state and adapt — modify what's there, don't blindly recreate.

Stop conditions:
- When the prototype satisfies the brief and you've verified it visually, return a one-line summary as plain text.
- If the brief is ambiguous, make a reasonable choice rather than asking.`;

const MAX_TURNS = 60;

function blockText(b: ContentBlock): string {
  if (b.type === "text") return b.text;
  return "";
}

export interface BuildOptions {
  brief: string;
  model?: string;
  verbose?: boolean;
}

export interface BuildResult {
  turns: number;
  finalAssistantText: string;
}

export async function penpotBuild({ brief, model, verbose }: BuildOptions): Promise<BuildResult> {
  const penpot = await connect("penpot");
  const mcpTools = await penpot.tools();
  const tools: AnthropicTool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as AnthropicTool["input_schema"],
  }));

  const userPrompt = `Brief:
${brief}

Begin by calling high_level_overview, then execute_code to inspect the current state of penpot.currentPage (existing boards/shapes/flows). Then build or iterate per the brief.

Conventions:
- Mobile boards 375×812 unless the brief says otherwise.
- Name boards by screen role. Name interactive shapes by interaction role.
- Use createBoard / createRectangle / createText / addInteraction / createFlow.
- Keep the visuals minimal and grayscale — Paper polishes later.
- Verify each board with export_shape before declaring done.`;

  const client = new Anthropic();
  const messages: MessageParam[] = [{ role: "user", content: userPrompt }];

  let turn = 0;
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

    if (response.stop_reason === "end_turn") break;
    if (response.stop_reason !== "tool_use") break;

    const toolResults: ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      try {
        const result = await penpot.call(block.name, block.input as Record<string, unknown>);
        const content = typeof result === "string" ? result : JSON.stringify(result);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: content.length > 6000 ? content.slice(0, 6000) + "...[truncated]" : content,
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
  }

  return { turns: turn, finalAssistantText };
}

if (import.meta.main) {
  const briefArgIdx = process.argv.findIndex((a, i) => i >= 2 && !a.startsWith("--"));
  const brief = briefArgIdx !== -1 ? process.argv[briefArgIdx] : "";
  if (!brief) {
    console.error("Usage: penpot-build '<brief>' [--verbose]");
    process.exit(1);
  }
  const verbose = process.argv.includes("--verbose");
  const result = await penpotBuild({ brief, verbose });
  console.log(`penpot-build: ${result.turns} turns`);
  if (result.finalAssistantText) console.log(result.finalAssistantText);
}
