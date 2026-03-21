# log-mcp [DEPRECATED]

> **⚠️ This project has been decommissioned.** Replaced by [Grafana Cloud](https://grafana.com/products/cloud/) + Grafana Alloy agents as of 2026-03-21.

## What this was

An MCP server that exposed journald logs for AI-assisted debugging, deployed on `box.makkib.com`. It let Claude query system logs directly from a chat conversation.

## What replaced it

**Grafana Cloud (free tier)** with Grafana Alloy agents on both VPS (box.makkib.com + sss.makkib.com):

- **Loki** — centralized log storage, queryable via LogQL in Grafana dashboards
- **Prometheus** — host metrics (CPU, RAM, disk, network)
- **Grafana MCP** — official MCP server ([grafana/mcp-grafana](https://github.com/grafana/mcp-grafana)) for conversational log/metric queries via Claude (planned)

This approach is superior because:
- Logs from both VPS are centralized (log-mcp could only see box)
- Persistent log history with 14-day retention (vs. live tailing only)
- Host metrics included (CPU, RAM, disk — log-mcp had no metrics)
- Alerting with Telegram notifications built in
- Monitoring infrastructure lives outside the monitored hosts

## Cleanup

On box.makkib.com:
```bash
systemctl stop log-mcp && systemctl disable log-mcp
rm /etc/systemd/system/log-mcp.service
rm /etc/nginx/mcp.d/log-mcp.conf   # if exists
systemctl reload nginx
rm -rf /home/ops/log-mcp
```

## Architecture docs

See [mcp-stack/docs/ARCHITECTURE.md](https://github.com/mabi8/mcp-stack/blob/main/docs/ARCHITECTURE.md) for the current infrastructure documentation.
