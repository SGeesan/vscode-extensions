import { createMcpExpressApp }from "@modelcontextprotocol/sdk/server/express.js";
import { isInitializeRequest }from "@modelcontextprotocol/sdk/types.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import server from "./server";
import { randomUUID } from "node:crypto";

const app = createMcpExpressApp();
const port = process.env.PORT ?? 3000;

// Store transports per session
const transports: Record<string, StreamableHTTPServerTransport> = {};

// POST endpoint for MCP requests
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  try {
    let transport: StreamableHTTPServerTransport;
    
    if (sessionId && transports[sessionId]) {
      // Reuse existing transport
      transport = transports[sessionId];
    } else if (!sessionId && isInitializeRequest(req.body)) {
      // New initialization request
      transport = buildNewTransport();

      // Connect server to transport ONCE
      await server.connect(transport);
    } else {
      // Invalid request
      res.status(400).json({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Bad Request: No valid session ID provided"
        },
        id: null
      });
      return;
    }

    // Handle request with existing transport
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('Error handling MCP request:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  }
});

// GET endpoint for SSE streams
app.get("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  console.log(`Establishing SSE stream for session ${sessionId}`);
  const transport = transports[sessionId];
  await transport.handleRequest(req, res);
});

// DELETE endpoint for session termination
app.delete("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }

  console.log(`Session termination request for session ${sessionId}`);
  
  try {
    const transport = transports[sessionId];
    await transport.handleRequest(req, res);
  } catch (error) {
    console.error('Error handling session termination:', error);
    if (!res.headersSent) {
      res.status(500).send("Error processing session termination");
    }
  }
});

// Start the HTTP server
app.listen(port, () => {
  console.log(`MCP server listening at http://localhost:${port}/mcp`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down Mcp server...');
  
  for (const sessionId in transports) {
    try {
      await transports[sessionId].close();
      delete transports[sessionId];
    } catch (error) {
      console.error(`Error closing transport for session ${sessionId}:`, error);
    }
  }
  
  console.log('Mcp Server shutdown complete');
  process.exit(0);
});

// Function to build a new StreamableHTTPServerTransport
function buildNewTransport(): StreamableHTTPServerTransport {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (newSessionId) => {
      console.log(`MCP Session initialized with ID: ${newSessionId}`);
      transports[newSessionId] = transport;
    }
  });

  // Set up cleanup handler
  transport.onclose = () => {
    const sid = transport.sessionId;
    if (sid && transports[sid]) {
      console.log(`Transport closed for session ${sid}`);
      delete transports[sid];
    }
  };
  return transport;
}

