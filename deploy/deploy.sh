#!/bin/bash
# deploy.sh - Deploy log-mcp to box.makkib.com
# Run this ON box.makkib.com as root (or with sudo)
set -euo pipefail

REPO_DIR="/opt/log-mcp"
SERVICE_USER="bclai"
SERVICE_NAME="log-mcp"

echo "=== Deploying Log MCP Server ==="

# 1. Clone/update repo
if [ -d "$REPO_DIR" ]; then
  echo "Updating existing installation..."
  cd "$REPO_DIR"
  git pull
else
  echo "Cloning repository..."
  git clone https://github.com/mabi8/log-mcp.git "$REPO_DIR"
  chown -R "$SERVICE_USER:$SERVICE_USER" "$REPO_DIR"
  cd "$REPO_DIR"
fi

# 2. Install dependencies and build
echo "Installing dependencies..."
sudo -u "$SERVICE_USER" npm ci --production=false
echo "Building TypeScript..."
sudo -u "$SERVICE_USER" npm run build

# 3. Ensure bclai user is in systemd-journal group (for journalctl access)
echo "Ensuring journal access..."
usermod -aG systemd-journal "$SERVICE_USER" 2>/dev/null || true

# 4. Install systemd service
echo "Installing systemd service..."
cp deploy/log-mcp.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# 5. Check status
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo "✅ $SERVICE_NAME is running"
  curl -s http://127.0.0.1:3850/health | python3 -m json.tool 2>/dev/null || echo "(health check)"
else
  echo "❌ $SERVICE_NAME failed to start"
  journalctl -u "$SERVICE_NAME" -n 20 --no-pager
  exit 1
fi

echo ""
echo "=== Next Steps ==="
echo "1. Add nginx config from deploy/nginx-log-mcp.conf to your box.makkib.com server block"
echo "2. sudo nginx -t && sudo systemctl reload nginx"
echo "3. Test SSE: curl -N https://box.makkib.com/logs/mcp/sse"
echo "4. Add to Claude.ai as MCP connector: https://box.makkib.com/logs/mcp"
echo ""
echo "Done!"
