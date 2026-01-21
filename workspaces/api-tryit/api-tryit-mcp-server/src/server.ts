import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import axios from "axios";
import { z } from "zod";

export type HttpRequestConfig = {
  method: string;
  url: string;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
  collectionName: string;
};

// MCP server instance
const server = new McpServer({
  name: "api-tryit-mcp-server",
  version: "1.0.0",
});

// register tools
server.registerTool("send-http-request", {
  title: "Send HTTP Request",
  description: "Sends an HTTP request to a specified URL with given method, headers, and body.",
  inputSchema: z.object({
    method: z.string("HTTP method (GET, POST, etc.)"),
    url: z.url("Valid URL to send the request to. query and path paramters should be injected in the url if any"),
    headers: z.record(z.string(), z.string(), "Optional HTTP headers").optional(),
    body: z.string("Optional request body").optional(),
    collectionName: z.string("A name for the collection to which this request belongs"),
  }),
  annotations: {
    readOnlyHint: true,
  }
}, async (request: HttpRequestConfig) => {
  const { url, method, headers, body } = request;
  if (!url || !method) {
    throw new Error("url and method are required");
  }
  try {
    const response = await axios.request({
      url: url,
      method: method,
      headers: headers,
      data: body,
    });
    const results = JSON.stringify({
      response: response.data,
      status: response.status
    });
    return {
      content: [{ type: "text", text: results }],
    };
  } catch (error: unknown) {
    let message = 'Unknown error';
    let status: number | undefined;
    let data: unknown;
    let errorCode: string | number | undefined;
    if (axios.isAxiosError(error)) {
      message = error.message;
      status = error.response?.status;
      data = error.response?.data;
      errorCode = error.code;
    } else if (error instanceof Error) {
      message = error.message;
    }

    throw new Error(`Error from the request: ${JSON.stringify({
      error:message,
      status,
      data,
      errorCode,}
    )}`);
  }
});

export default server;