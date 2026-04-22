#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MavenRepositorySearcher } from "./searcher.js";
import { SearchResult, ArtifactVersions, DependencySnippet } from "./types.js";
import { Command } from "commander";
import http from "node:http";
import { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };

class MavenRepositoryServer {
    private server: McpServer;
    private searcher: MavenRepositorySearcher;

    constructor() {
        this.searcher = new MavenRepositorySearcher();
        this.server = this.createMcpServer();
        this.setupErrorHandling();
    }

    private createMcpServer(): McpServer {
        const mcpServer = new McpServer({
            name: "mvn-repository-mcp-server",
            version: packageJson.version,
        });
        this.registerTools(mcpServer);
        return mcpServer;
    }

    private registerTools(mcpServer: McpServer): void {
        mcpServer.registerTool(
            "search_maven_artifacts",
            {
                description: "Search for Maven artifacts on mvnrepository.com",
                inputSchema: z.object({
                    query: z.string().describe("Search query for Maven artifacts"),
                    maxResults: z.number().optional().default(10).describe("Maximum number of results to return (default: 10)"),
                }),
            },
            async ({ query, maxResults }) => {
                return await this.searchMavenArtifacts(query, maxResults ?? 10);
            }
        );

        mcpServer.registerTool(
            "get_artifact_versions",
            {
                description: "Get all available versions of a Maven artifact",
                inputSchema: z.object({
                    groupId: z.string().describe("The group ID of the artifact (e.g., 'org.springframework')"),
                    artifactId: z.string().describe("The artifact ID (e.g., 'spring-core')"),
                }),
            },
            async ({ groupId, artifactId }) => {
                return await this.getArtifactVersions(groupId, artifactId);
            }
        );

        mcpServer.registerTool(
            "get_pom_xml",
            {
                description: "Fetch the pom.xml file for a specific artifact version",
                inputSchema: z.object({
                    groupId: z.string().describe("The group ID of the artifact"),
                    artifactId: z.string().describe("The artifact ID"),
                    version: z.string().describe("The version of the artifact"),
                }),
            },
            async ({ groupId, artifactId, version }) => {
                return await this.getPomXml(groupId, artifactId, version);
            }
        );

        mcpServer.registerTool(
            "get_dependency_snippets",
            {
                description: "Get Maven, Gradle, and other build tool dependency snippets for an artifact",
                inputSchema: z.object({
                    groupId: z.string().describe("The group ID of the artifact"),
                    artifactId: z.string().describe("The artifact ID"),
                    version: z.string().describe("The version of the artifact"),
                }),
            },
            async ({ groupId, artifactId, version }) => {
                return await this.getDependencySnippets(groupId, artifactId, version);
            }
        );
    }

    private async searchMavenArtifacts(query: string, maxResults: number): Promise<any> {
        try {
            const result: SearchResult = await this.searcher.searchArtifacts(query, maxResults);

            const artifactsText = result.artifacts.map(artifact =>
                `${artifact.groupId}:${artifact.artifactId}:${artifact.version}${artifact.description ? ` - ${artifact.description}` : ''}`
            ).join('\n');

            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${result.artifacts.length} artifacts for query "${query}":\n\n${artifactsText}`,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error searching for Maven artifacts: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    },
                ],
            };
        }
    }

    private async getArtifactVersions(groupId: string, artifactId: string): Promise<any> {
        try {
            const result: ArtifactVersions = await this.searcher.getArtifactVersions(groupId, artifactId);

            const versionsText = result.versions.map(version => {
                let versionInfo = `${version.version}`;
                if (version.releaseDate) {
                    versionInfo += ` (${version.releaseDate})`;
                }
                if (version.vulnerabilities && version.vulnerabilities > 0) {
                    versionInfo += ` - ${version.vulnerabilities} vulnerabilities`;
                }
                return versionInfo;
            }).join('\n');

            return {
                content: [
                    {
                        type: "text",
                        text: `Found ${result.totalVersions} versions for ${groupId}:${artifactId}:\n\n${versionsText}`,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error fetching versions for ${groupId}:${artifactId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    },
                ],
            };
        }
    }

    private async getPomXml(groupId: string, artifactId: string, version: string): Promise<any> {
        try {
            const pomContent = await this.searcher.getPomXml(groupId, artifactId, version);

            return {
                content: [
                    {
                        type: "text",
                        text: `POM.xml for ${groupId}:${artifactId}:${version}:\n\n\`\`\`xml\n${pomContent}\n\`\`\``,
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error fetching POM for ${groupId}:${artifactId}:${version}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    },
                ],
            };
        }
    }

    private async getDependencySnippets(groupId: string, artifactId: string, version: string): Promise<any> {
        try {
            const snippets: DependencySnippet = await this.searcher.getDependencySnippets(groupId, artifactId, version);

            let snippetsText = `Dependency snippets for ${groupId}:${artifactId}:${version}:\n\n`;

            snippetsText += `**Maven:**\n\`\`\`xml\n${snippets.maven}\n\`\`\`\n\n`;
            snippetsText += `**Gradle:**\n\`\`\`gradle\n${snippets.gradle}\n\`\`\`\n\n`;

            if (snippets.sbt) {
                snippetsText += `**SBT:**\n\`\`\`scala\n${snippets.sbt}\n\`\`\`\n\n`;
            }

            if (snippets.ivy) {
                snippetsText += `**Ivy:**\n\`\`\`xml\n${snippets.ivy}\n\`\`\`\n\n`;
            }

            return {
                content: [
                    {
                        type: "text",
                        text: snippetsText.trim(),
                    },
                ],
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Error fetching dependency snippets for ${groupId}:${artifactId}:${version}: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    },
                ],
            };
        }
    }

    private setupErrorHandling(): void {
        this.server.server.onerror = (error) => {
            console.error("[MCP Error]", error);
        };

        process.on("SIGINT", async () => {
            await this.server.close();
            process.exit(0);
        });
    } 
    
    async runStdio(): Promise<void> {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error("Maven Repository MCP server running on stdio");
    }

    async runHttp(port: number): Promise<void> {
        const transports = new Map<string, StreamableHTTPServerTransport>();

        const httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url!, `http://${req.headers.host}`);

            if (url.pathname !== "/mcp") {
                res.writeHead(404);
                res.end("Not found");
                return;
            }

            const sessionId = req.headers["mcp-session-id"] as string | undefined;

            if (req.method === "DELETE") {
                if (sessionId && transports.has(sessionId)) {
                    await transports.get(sessionId)!.close();
                    transports.delete(sessionId);
                }
                res.writeHead(200);
                res.end();
                return;
            }

            if (req.method !== "POST" && req.method !== "GET") {
                res.writeHead(405);
                res.end("Method not allowed");
                return;
            }

            let transport: StreamableHTTPServerTransport;

            if (!sessionId) {
                transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (id) => {
                        transports.set(id, transport);
                    },
                    onsessionclosed: (id) => {
                        transports.delete(id);
                    },
                });
                const sessionServer = this.createMcpServer();
                await sessionServer.connect(transport);
            } else {
                const existing = transports.get(sessionId);
                if (!existing) {
                    res.writeHead(404);
                    res.end("Session not found");
                    return;
                }
                transport = existing;
            }

            await transport.handleRequest(req, res);
        });

        httpServer.listen(port, () => {
            console.error(`Maven Repository MCP server running on Streamable HTTP at http://localhost:${port}/mcp`);
        });
    }
}

const program = new Command();

program
    .name("mvn-repository-mcp-server")
    .description("Maven Repository MCP Server - Search mvnrepository.com artifacts")
    .version(packageJson.version);

program
    .command("stdio")
    .description("Run server using stdio transport (default)")
    .action(async () => {
        console.error("Starting Maven Repository MCP server with stdio transport...");
        const server = new MavenRepositoryServer();
        await server.runStdio();
    });

program
    .command("http")
    .description("Run server using Streamable HTTP transport")
    .option("-p, --port <port>", "Port to listen on", "3000")
    .action(async (options) => {
        const port = parseInt(options.port);
        if (isNaN(port) || port < 1 || port > 65535) {
            console.error("Error: Port must be a number between 1 and 65535");
            process.exit(1);
        }

        console.error(`Starting Maven Repository MCP server with Streamable HTTP transport on port ${port}...`);
        const server = new MavenRepositoryServer();
        await server.runHttp(port);
    });

// Default to stdio if no command is provided
if (process.argv.length === 2) {
    console.error("Starting Maven Repository MCP server with stdio transport (default)...");
    const server = new MavenRepositoryServer();
    server.runStdio().catch((error) => {
        console.error("Fatal error in main():", error);
        process.exit(1);
    });
} else {
    program.parseAsync(process.argv).catch((error) => {
        console.error("Fatal error in main():", error);
        process.exit(1);
    });
}
