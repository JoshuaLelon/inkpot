// Minimal MCP client over Streamable HTTP for Penpot + Paper.
// Each McpClient holds a session id and lets you list tools and call them.

const SERVERS = {
  penpot: "http://localhost:4401/mcp",
  paper: "http://127.0.0.1:29979/mcp",
} as const;

export type ServerName = keyof typeof SERVERS;

export class McpClient {
  private sessionId?: string;
  private nextId = 1;

  constructor(public readonly server: ServerName) {}

  private get url() {
    return SERVERS[this.server];
  }

  private async post(body: unknown): Promise<{ headers: Headers; rawText: string }> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    if (this.sessionId) headers["mcp-session-id"] = this.sessionId;

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const rawText = await res.text();
    return { headers: res.headers, rawText };
  }

  private parseEventStream(text: string): unknown {
    const lines = text.split(/\r?\n/);
    let result: unknown = null;
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const json = line.slice("data: ".length);
        try {
          result = JSON.parse(json);
        } catch {
          /* ignore parse errors on partial lines */
        }
      }
    }
    if (result === null) {
      try {
        result = JSON.parse(text);
      } catch {
        throw new Error(`MCP response unparseable: ${text.slice(0, 500)}`);
      }
    }
    return result;
  }

  async init(): Promise<void> {
    const { headers, rawText } = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "inkpot", version: "0.0.1" },
      },
    });
    const sid = headers.get("mcp-session-id");
    if (!sid) throw new Error(`${this.server} MCP init returned no session id`);
    this.sessionId = sid;
    this.parseEventStream(rawText); // ensure we drained it
    await this.post({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async tools(): Promise<Array<{ name: string; description?: string; inputSchema: unknown }>> {
    const { rawText } = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/list",
    });
    const parsed = this.parseEventStream(rawText) as {
      result: { tools: Array<{ name: string; description?: string; inputSchema: unknown }> };
    };
    return parsed.result.tools;
  }

  async call(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { rawText } = await this.post({
      jsonrpc: "2.0",
      id: this.nextId++,
      method: "tools/call",
      params: { name, arguments: args },
    });
    const parsed = this.parseEventStream(rawText) as {
      result?: { content: Array<{ type: string; text: string }>; isError?: boolean };
      error?: { message: string };
    };
    if (parsed.error) throw new Error(`${this.server}.${name}: ${parsed.error.message}`);
    if (!parsed.result) throw new Error(`${this.server}.${name} returned no result`);
    if (parsed.result.isError) {
      const msg = parsed.result.content.map((c) => c.text).join("\n");
      throw new Error(`${this.server}.${name}: ${msg}`);
    }
    const text = parsed.result.content.find((c) => c.type === "text")?.text;
    if (text === undefined) return parsed.result;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
}

export async function connect(server: ServerName): Promise<McpClient> {
  const c = new McpClient(server);
  await c.init();
  return c;
}
