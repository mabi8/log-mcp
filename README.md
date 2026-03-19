# log-mcp

MCP server exposing journald logs for AI-assisted debugging. Deployed on `box.makkib.com` alongside CenterDevice MCP and Bidrento MCP.

## What it does

Lets Claude (or any MCP client) query system logs directly from a chat conversation:

- **"Check bclai for errors"** → calls `get_errors` tool
- **"What's the health of all BCL services?"** → calls `get_service_health`
- **"Search logs for 'timeout' in the last 24h"** → calls `search_logs`
- **"Show me the last 30 lines from cdmcp"** → calls `tail_logs`

## Tools

| Tool | Description |
|------|-------------|
| `query_logs` | Query by service, time range, severity, keyword |
| `get_errors` | Recent errors across services (quick debug shortcut) |
| `get_service_health` | Uptime, error/warning counts, last restart per service |
| `tail_logs` | Last N lines from a specific service |
| `search_logs` | Full-text regex search across all services |
| `list_services` | Show all monitored services |

## Monitored Services

- `bclai` — BCL Telegram bot
- `cdmcp` — CenterDevice MCP server
- `bidrento-mcp` — Bidrento MCP server
- `bcl-wa-bot` — BCL WhatsApp bot (planned)
- `log-mcp` — This server (self-monitoring)

## Deployment

```bash
# On box.makkib.com as root:
# Creates user 'logmcp', clones to /home/logmcp/log-mcp, builds, installs service
curl -s https://raw.githubusercontent.com/mabi8/log-mcp/main/deploy/deploy.sh | bash
# Or manually:
git clone https://github.com/mabi8/log-mcp.git /tmp/log-mcp-install
cd /tmp/log-mcp-install
bash deploy/deploy.sh
```

Then add nginx config from `deploy/nginx-log-mcp.conf` to your server block.

## Architecture

```
journald ← bclai, cdmcp, bidrento-mcp (structured JSON logs)
    │
    ▼
log-mcp (port 3850, SSE) — runs as user 'logmcp' under /home/logmcp/
    │
    ▼
nginx (box.makkib.com/logs/mcp)
    │
    ▼
Claude.ai (MCP connector)
```

## MCP Endpoint

- **SSE:** `https://box.makkib.com/logs/mcp/sse`
- **Messages:** `https://box.makkib.com/logs/mcp/messages`
- **Health:** `https://box.makkib.com/logs/mcp/health`

## Adding a New Service

1. Ensure the service writes to journald with a unique `SyslogIdentifier`
2. Add the identifier to `KNOWN_SERVICES` in `src/journald.ts`
3. Rebuild and restart: `cd /home/logmcp/log-mcp && sudo -u logmcp npm run build && sudo systemctl restart log-mcp`

## Development

```bash
npm install
npm run dev   # runs with ts-node
npm run build # compiles to dist/
```
