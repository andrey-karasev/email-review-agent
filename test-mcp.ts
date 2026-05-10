import "dotenv/config";
import path from "path";
import fs from "fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const provider = "gmail";
  const serverDirName = "gmail-mcp-server";
  const serverPath = path.resolve(process.cwd(), "..", serverDirName);
  const serverScript = path.join(serverPath, "dist", "index.js");

  const serverEnvPath = path.join(serverPath, ".env");
  const serverEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  
  if (fs.existsSync(serverEnvPath)) {
    const envFileContent = fs.readFileSync(serverEnvPath, "utf-8");
    envFileContent.split("\n").forEach(line => {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        if (!key) return;
        let value = match[2] || "";
        if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        }
        serverEnv[key] = value;
      }
    });
  }

  console.log("Connecting...");
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverScript],
    env: serverEnv
  });

  const client = new Client({ name: "test", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);
  
  console.log("Connected. Calling tool...");
  try {
    const result = await client.callTool({
      name: "gmail_list_emails",
      arguments: { limit: 5 }
    });
    console.log("Result:", result);
  } catch (err: any) {
    console.error("Error:", err.message);
  }
  
  await transport.close();
}

main().catch(console.error);
