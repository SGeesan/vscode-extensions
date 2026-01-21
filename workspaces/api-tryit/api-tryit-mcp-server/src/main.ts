import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import server from "./server.js";

// transport layer for MCP server
const transport = new StdioServerTransport();

async function activateMcpServer() {
await server.connect(transport);
}

activateMcpServer().catch((err) => {
    console.error("Failed to activate MCP server:", err);
    process.exit(1);
});

