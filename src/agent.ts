import "dotenv/config";
import path from "path";
import fs from "fs";
import { select, input } from "@inquirer/prompts";
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  // Ensure we have an OpenAI key before proceeding
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: OPENAI_API_KEY environment variable is missing.");
    process.exit(1);
  }

  const provider = await select({
    message: "Which email provider would you like to review?",
    choices: [
      { name: "Gmail", value: "gmail" },
      { name: "Outlook", value: "outlook" }
    ]
  });

  const serverDirName = provider === "gmail" ? "gmail-mcp-server" : "outlook-mcp-server";
  const serverPath = path.resolve(process.cwd(), "..", serverDirName);
  const serverScript = path.join(serverPath, "dist", "index.js");

  if (!fs.existsSync(serverScript)) {
    console.error(`Error: Could not find MCP server at ${serverScript}`);
    console.error(`Please ensure the ${serverDirName} project is built.`);
    process.exit(1);
  }

  // Load the server's specific .env file to ensure it has its credentials
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

  console.log(`Connecting to ${provider} MCP server...`);
  
  const transport = new StdioClientTransport({
    command: "node",
    args: [serverScript],
    env: serverEnv
  });

  const client = new Client({
    name: "email-review-agent",
    version: "1.0.0"
  }, {
    capabilities: {}
  });

  await client.connect(transport);
  
  console.log("Connected successfully. Fetching recent emails...");

  let emails: any[] = [];
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const toolName = provider === "gmail" ? "gmail_list_emails" : "outlook_list_emails";
    const result = await client.callTool({
      name: toolName,
      arguments: { limit: 50 }
    });

    const content = result.content as any[];
    if (content && content.length > 0 && content[0].type === "text") {
      emails = JSON.parse(content[0].text);
    }
  } catch (err: any) {
    clearInterval(keepAlive);
    console.error("Error fetching emails via MCP:", err.message);
    process.exit(1);
  }
  clearInterval(keepAlive);

  if (!emails || emails.length === 0) {
    console.log("No recent emails found.");
    process.exit(0);
  }

  console.log(`Fetched ${emails.length} recent emails.`);

  const filterPrompt = await input({ 
    message: "Enter your filtering prompt (e.g., 'all emails about marketing'):" 
  });

  if (!filterPrompt.trim()) {
    console.log("No prompt provided. Exiting.");
    process.exit(0);
  }

  console.log("Analyzing emails with AI...");

  // Format emails for the prompt to save tokens. Outlook vs Gmail structure might differ slightly.
  const emailsForPrompt = emails.map(e => ({
    id: e.id,
    subject: e.subject || "(No Subject)",
    snippet: e.snippet || e.bodyPreview || ""
  }));

  const openai = new OpenAI();

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that reviews a list of emails and filters them based on the user's criteria. Return a JSON object with a single key 'filteredSubjects' containing an array of the exact subjects of the emails that match."
        },
        {
          role: "user",
          content: `Filtering Criteria: ${filterPrompt}\n\nEmails:\n${JSON.stringify(emailsForPrompt, null, 2)}`
        }
      ],
      response_format: { type: "json_object" },
    });

    const parsedContent = response.choices[0]?.message.content || '{"filteredSubjects": []}';
    const parsed = JSON.parse(parsedContent);
    
    if (parsed && parsed.filteredSubjects.length > 0) {
      console.log(`\nFound ${parsed.filteredSubjects.length} matching email(s):\n`);
      parsed.filteredSubjects.forEach((subject: string, i: number) => {
        console.log(`${i + 1}. ${subject}`);
      });
    } else {
      console.log("\nNo emails matched your criteria.");
    }
  } catch (error) {
    console.error("Error evaluating emails:", error);
  } finally {
    // Cleanly close the transport
    await transport.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
