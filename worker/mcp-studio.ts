/**
 * MCP server exposing the JANUXAI studio tools to the local Claude Code CLI
 * (development engine). Started by the CLI over stdio for one reply; the
 * conversation, reply message and run come from environment variables.
 * Nothing may be printed to stdout except the MCP protocol.
 */
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getDb } from "../src/lib/db";
import { closeBrowser } from "../src/lib/graphics/render";
import { runStudioTool, STUDIO_TOOLS } from "../src/lib/studio/tools";

const conversationId = process.env.JANUX_CONVERSATION_ID ?? "";
const messageId = process.env.JANUX_MESSAGE_ID ?? "";
const runId = process.env.JANUX_RUN_ID ?? "";

function shouldCancel() {
  const r = getDb().prepare("SELECT state FROM agent_runs WHERE id = ?").get(runId) as { state: string } | undefined;
  // Stop working as soon as the reply is no longer active (stopped, failed or interrupted).
  return !r || r.state !== "running";
}

const server = new McpServer({ name: "janux-studio", version: "1.0.0" });

for (const t of STUDIO_TOOLS) {
  server.registerTool(t.name, { description: t.description, inputSchema: t.schema as never }, (async (input: unknown) => {
    const out = await runStudioTool(t.name, input, { conversationId, messageId, runId, shouldCancel });
    const content: ({ type: "text"; text: string } | { type: "image"; data: string; mimeType: string })[] = [{ type: "text", text: out.text }];
    for (const img of (out.images ?? []).slice(0, 8)) {
      if (!fs.existsSync(img)) continue;
      content.push({ type: "image", data: fs.readFileSync(img).toString("base64"), mimeType: img.endsWith(".png") ? "image/png" : "image/jpeg" });
    }
    return { content, isError: !!out.isError };
  }) as never);
}

// Close Chrome when the reply ends, so no renderer is left running.
let exiting = false;
async function shutdown() {
  if (exiting) return;
  exiting = true;
  await closeBrowser();
  process.exit(0);
}
process.stdin.on("close", () => void shutdown());
for (const sig of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(sig, () => void shutdown());
// A failed render must not take the whole tool server down.
process.on("unhandledRejection", (err) => console.error("[mcp-studio] unhandled", err));

void server.connect(new StdioServerTransport());
