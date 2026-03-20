import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { queryLogs, getServiceHealth, getKnownServices, type LogEntry, type ServiceHealth } from './journald.js';

const PORT = parseInt(process.env.PORT || '3850', 10);

// --- MCP Server Definition ---

function createServer(): McpServer {
  const server = new McpServer({
    name: 'log-mcp',
    version: '1.0.0',
  });

  // Tool: query_logs
  server.tool(
    'query_logs',
    'Query journald logs by service, time range, severity level, and keyword. Returns structured log entries.',
    {
      service: z.string().optional().describe(
        'Service name (e.g. "bcl-telegram", "mcp-centerdevice", "mcp-bidrento"). Comma-separated for multiple. Omit for all services.'
      ),
      since: z.string().optional().describe(
        'Start time. Accepts: "1 hour ago", "30 minutes ago", "today", "yesterday", "2025-03-20 10:00:00". Default: 1 hour ago.'
      ),
      until: z.string().optional().describe('End time. Same format as "since".'),
      level: z.enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']).optional().describe(
        'Minimum severity level. "err" returns err+crit+alert+emerg. Default: all levels.'
      ),
      grep: z.string().optional().describe('Full-text search pattern (case-insensitive regex).'),
      lines: z.number().optional().describe('Max number of log entries to return (1-500). Default: 50.'),
    },
    async (params) => {
      try {
        const entries = queryLogs({
          service: params.service,
          since: params.since || '1 hour ago',
          until: params.until,
          level: params.level,
          grep: params.grep,
          lines: params.lines,
        });

        if (entries.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No log entries found matching criteria: service=${params.service || 'all'}, since=${params.since || '1 hour ago'}, level=${params.level || 'all'}, grep=${params.grep || 'none'}`,
            }],
          };
        }

        const summary = `Found ${entries.length} log entries (${params.service || 'all services'}, since ${params.since || '1 hour ago'})`;
        const formatted = entries.map(formatEntry).join('\n');

        return {
          content: [{
            type: 'text' as const,
            text: `${summary}\n\n${formatted}`,
          }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error querying logs: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: get_errors
  server.tool(
    'get_errors',
    'Get recent errors across all (or specific) services. Quick shortcut for debugging.',
    {
      service: z.string().optional().describe('Service name or comma-separated list. Omit for all services.'),
      since: z.string().optional().describe('Time window. Default: "6 hours ago".'),
      lines: z.number().optional().describe('Max errors to return. Default: 20.'),
    },
    async (params) => {
      try {
        const entries = queryLogs({
          service: params.service,
          since: params.since || '6 hours ago',
          level: 'err',
          lines: params.lines || 20,
        });

        if (entries.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `✅ No errors found${params.service ? ` for ${params.service}` : ''} in the last ${params.since || '6 hours'}. All clear.`,
            }],
          };
        }

        const byService = groupBy(entries, e => e.service);
        let text = `⚠️ Found ${entries.length} error(s) since ${params.since || '6 hours ago'}:\n\n`;

        for (const [svc, errs] of Object.entries(byService)) {
          text += `── ${svc} (${errs.length} errors) ──\n`;
          for (const e of errs) {
            text += formatEntry(e) + '\n';
          }
          text += '\n';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: get_service_health
  server.tool(
    'get_service_health',
    'Health overview: uptime, error/warning counts (24h), last error, last restart for each service.',
    {
      service: z.string().optional().describe('Specific service name. Omit for all known services.'),
    },
    async (params) => {
      try {
        const health = getServiceHealth(params.service);
        let text = '🏥 Service Health Report\n\n';

        for (const h of health) {
          const status = h.active ? '🟢 active' : '🔴 inactive';
          text += `── ${h.service} ──\n`;
          text += `  Status: ${status}`;
          if (h.uptime) text += ` (uptime: ${h.uptime})`;
          text += '\n';
          if (h.lastRestart) text += `  Last restart: ${h.lastRestart}\n`;
          text += `  Errors (24h): ${h.errorCount24h}\n`;
          text += `  Warnings (24h): ${h.warningCount24h}\n`;
          if (h.lastError) {
            text += `  Last error: [${h.lastError.timestamp}] ${h.lastError.message}\n`;
          }
          text += '\n';
        }

        return { content: [{ type: 'text' as const, text }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: tail_logs
  server.tool(
    'tail_logs',
    'Get the last N log lines from a specific service. Like "tail -f" but for AI consumption.',
    {
      service: z.string().describe('Service name (e.g. "bcl-telegram", "mcp-centerdevice").'),
      lines: z.number().optional().describe('Number of lines. Default: 30.'),
      level: z.enum(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug']).optional(),
    },
    async (params) => {
      try {
        const entries = queryLogs({
          service: params.service,
          lines: params.lines || 30,
          level: params.level,
          since: '7 days ago', // broad window, limited by line count
        });

        if (entries.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No recent logs found for ${params.service}. Is the service running?`,
            }],
          };
        }

        const text = `Last ${entries.length} entries from ${params.service}:\n\n` +
          entries.map(formatEntry).join('\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: search_logs
  server.tool(
    'search_logs',
    'Full-text search across all services within a time window. Useful for finding specific errors, request IDs, or patterns.',
    {
      query: z.string().describe('Search term or regex pattern (case-insensitive).'),
      since: z.string().optional().describe('Start time. Default: "24 hours ago".'),
      until: z.string().optional().describe('End time.'),
      service: z.string().optional().describe('Limit to specific service(s).'),
      lines: z.number().optional().describe('Max results. Default: 30.'),
    },
    async (params) => {
      try {
        const entries = queryLogs({
          service: params.service,
          since: params.since || '24 hours ago',
          until: params.until,
          grep: params.query,
          lines: params.lines || 30,
        });

        if (entries.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No matches for "${params.query}" in the last ${params.since || '24 hours'}.`,
            }],
          };
        }

        const text = `Found ${entries.length} matches for "${params.query}":\n\n` +
          entries.map(formatEntry).join('\n');

        return { content: [{ type: 'text' as const, text }] };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${err.message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool: list_services
  server.tool(
    'list_services',
    'List all known/monitored services.',
    {},
    async () => {
      const services = getKnownServices();
      return {
        content: [{
          type: 'text' as const,
          text: `Monitored services:\n${services.map(s => `  • ${s}`).join('\n')}`,
        }],
      };
    }
  );

  return server;
}

// --- Formatting helpers ---

function formatEntry(entry: LogEntry): string {
  const level = entry.level.toUpperCase().padEnd(7);
  const ts = entry.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '');
  let line = `[${ts}] ${level} [${entry.service}] ${entry.message}`;

  // Add relevant structured fields (skip noise)
  const skip = new Set(['message', 'msg', 'pid', 'unit', 'level', 'timestamp', 'service']);
  const extra = Object.entries(entry.fields)
    .filter(([k, v]) => !skip.has(k) && v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);

  if (extra.length > 0) {
    line += ` | ${extra.join(', ')}`;
  }

  return line;
}

function groupBy<T>(arr: T[], fn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of arr) {
    const key = fn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}

// --- Stateless Streamable HTTP Transport ---
// Each request creates a fresh McpServer + transport. No session tracking.
// This is the simplest pattern that works with Claude.ai.

async function main() {
  const app = express();

  // Parse JSON bodies for the /mcp endpoint
  app.use(express.json());

  // --- Bearer token auth (optional) ---
  const AUTH_TOKEN = process.env.LOG_MCP_AUTH_TOKEN;
  if (!AUTH_TOKEN) {
    console.warn('[log-mcp] WARNING: No LOG_MCP_AUTH_TOKEN set — running without auth');
  }

  if (AUTH_TOKEN) {
    app.use((req, res, next) => {
      if (req.path === '/health') return next();
      const authHeader = req.headers.authorization;
      if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        console.warn(`[log-mcp] Unauthorized request from ${req.ip} to ${req.path}`);
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      next();
    });
  }

  // Streamable HTTP endpoint — handles POST, GET, DELETE on /mcp
  app.all('/mcp', async (req, res) => {
    // Only POST is supported in stateless mode
    if (req.method === 'GET' || req.method === 'DELETE') {
      res.status(405).set('Allow', 'POST').json({ error: 'Method not allowed in stateless mode' });
      return;
    }

    console.log(`[log-mcp] ${req.method} /mcp from ${req.ip} — ${req.body?.method || 'unknown'}`);

    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless — no sessions
    });

    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err: any) {
      console.error('[log-mcp] MCP error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error' },
          id: null,
        });
      }
    }
  });

  // Health check (unauthenticated)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: '2.0.0', services: getKnownServices() });
  });

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[log-mcp] Server listening on 127.0.0.1:${PORT}`);
    console.log(`[log-mcp] MCP endpoint: http://127.0.0.1:${PORT}/mcp`);
    console.log(`[log-mcp] Health check: http://127.0.0.1:${PORT}/health`);
  });
}

main().catch(err => {
  console.error('[log-mcp] Fatal error:', err);
  process.exit(1);
});
