import { MCPClient, MCPServer } from "@mastra/mcp";
import { hermesSupervisorAgent } from "../agents/hermes-supervisor.ts";
import { queryHermesKnowledgeTool } from "../rag/knowledge.ts";
import { executeHermesTaskTool } from "../tools/hermes-execution.ts";
import { hermesTaskLifecycle } from "../workflows/hermes-task-lifecycle.ts";

export const hermesMastraMcpServer = new MCPServer({
  id: "hermes-mastra",
  name: "Hermes Mastra Orchestration",
  version: "0.1.0",
  agents: { hermesSupervisorAgent },
  tools: { queryHermesKnowledgeTool, executeHermesTaskTool },
  workflows: { hermesTaskLifecycle },
});

export function createHermesToolsMcpClient(options: {
  pythonExecutable: string;
  projectRoot: string;
}): MCPClient {
  return new MCPClient({
    id: "hermes-curated-tools",
    timeout: 60_000,
    servers: {
      hermes: {
        command: options.pythonExecutable,
        args: ["-m", "agent.transports.hermes_tools_mcp_server"],
        cwd: options.projectRoot,
        env: {},
        inheritDefaultEnv: false,
        requireToolApproval: true,
      },
    },
  });
}
