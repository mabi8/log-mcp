#!/bin/bash
# deploy.sh - Deploy log-mcp to box.makkib.com
# Run this ON box.makkib.com as root (or with sudo)
set -euo pipefail

SERVICE_USER="logmcp"
REPO_DIR="/home/${SERVICE_USER}/log-mcp"
SERVICE_NAME="log-mcp"

echo "=== Deploying Log MCP Server ==="

# 1. Create dedicated user if not exists
if ! id "$SERVICE_USER" &>/dev/null; then
  echo "Creating user $SERVICE_USER..."
  useradd -r -m -s /bin/bash "$SERVICE_USER"
fi

# 2. Clone/update repo
if [ -d "$REPO_DIR" ]; then
  echo "Updating existing installation..."
  cd "$REPO_DIR"
  sudo -u "$SERVICE_USER" git pull
else
  echo "Cloning repository..."
  sudo -u "$SERVICE_USER" git clone https://github.com/mabi8/log-mcp.git "$REPO_DIR"
  cd "$REPO_DIR"
fi

# 3. Install dependencies and build
echo "Installing dependencies..."
cd "$REPO_DIR"
sudo -u "$SERVICE_USER" npm ci --production=false
echo "Building TypeScript..."
sudo -u "$SERVICE_USER" npm run build

# 4. Ensure logmcp user is in systemd-journal group (for journalctl access)
echo "Ensuring journal access..."
usermod -aG systemd-journal "$SERVICE_USER" 2>/dev/null || true

# 5. Install systemd service
echo "Installing systemd service..."
cp deploy/log-mcp.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# 6. Check status
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
