import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import axios from "axios";
import {z} from "zod";

// MCP server instance
const server = new McpServer({
  name: "api-tryit-mcp-server",
  version: "1.0.0",
});

// register tools/resources here…
server.registerTool("try-resource", {
  title: "Try Resource",
  description: "Sends a request to try a resource",
    inputSchema: z.object({
    resourceUrl: z.string(),
    method: z.string()
    }),
  annotations:{
    readOnlyHint: true,
  }
}, async ({resourceUrl, method}) => {
    if (!resourceUrl || !method) {
        throw new Error("resourceUrl and method are required");
    }
    try {
    const response = await axios.request({
        url: resourceUrl,
        method: method as any,
    });
    const results = JSON.stringify(response.data);
    return {
        content: [{ type: "text", text: results }],
    };
    } catch (error: any) {
      console.error('Error in try-resource tool:', error);
        return {
            content: [{ type: "text", text: JSON.stringify(error) }],
        };
    }
});

export default server;