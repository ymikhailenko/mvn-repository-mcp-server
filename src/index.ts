#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MavenRepositorySearcher } from "./searcher.js";
import { SearchResult, ArtifactVersions, DependencySnippet } from "./types.js";
import { Command } from "commander";
import http from "node:http";
import { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

class MavenRepositoryServer {
    private server: McpServer;
    private searcher: MavenRepositorySearcher;

    constructor() {
        this.searcher = new MavenRepositorySearcher();
        this.server = new McpServer({
            name: "mvn-repository-mcp-server",
            version: "0.0.1",
        });

        this.setupToolHandlers();
        this.setupErrorHandling();
    }

    private setupToolHandlers(): void {
        this.server.registerTool(
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

        this.server.registerTool(
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

        this.server.registerTool(
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

        this.server.registerTool(
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

    async runSSE(port: number): Promise<void> {
        const server = http.createServer();
        const transports = new Map<string, SSEServerTransport>();

        server.on("request", async (req: IncomingMessage, res: ServerResponse) => {
            const url = new URL(req.url!, `http://${req.headers.host}`);
            if (req.method === "GET" && url.pathname === "/sse") {
                console.error("New SSE connection");
                const transport = new SSEServerTransport("/message", res);
                await this.server.connect(transport);
                transports.set(transport.sessionId, transport);

                transport.onclose = () => {
                    console.error("SSE connection closed");
                    transports.delete(transport.sessionId);
                };
            } else if (req.method === "POST" && url.pathname === "/message") {
                const sessionId = url.searchParams.get("sessionId");
                if (sessionId && transports.has(sessionId)) {
                    const transport = transports.get(sessionId)!;
                    await transport.handlePostMessage(req, res);
                } else {
                    res.writeHead(404);
                    res.end("Session not found");
                }
            } else {
                res.writeHead(404);
                res.end("Not found");
            }
        });

        server.listen(port, () => {
            console.error(`Maven Repository MCP server running on SSE at http://localhost:${port}/sse`);
        });
    }
}

const program = new Command();

program
    .name("mvn-repository-mcp-server")
    .description("Maven Repository MCP Server - Search mvnrepository.com artifacts")
    .version("0.0.1");

program
    .command("stdio")
    .description("Run server using stdio transport (default)")
    .action(async () => {
        console.error("Starting Maven Repository MCP server with stdio transport...");
        const server = new MavenRepositoryServer();
        await server.runStdio();
    });

program
    .command("sse")
    .description("Run server using SSE transport")
    .option("-p, --port <port>", "Port to listen on", "3000")
    .action(async (options) => {
        const port = parseInt(options.port);
        if (isNaN(port) || port < 1 || port > 65535) {
            console.error("Error: Port must be a number between 1 and 65535");
            process.exit(1);
        }

        console.error(`Starting Maven Repository MCP server with SSE transport on port ${port}...`);
        const server = new MavenRepositoryServer();
        await server.runSSE(port);
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
