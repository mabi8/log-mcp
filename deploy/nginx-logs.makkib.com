# logs.makkib.com — Log MCP Server
# Install: cp deploy/nginx-logs.makkib.com /etc/nginx/sites-enabled/logs.makkib.com
# Then: nginx -t && systemctl reload nginx

server {
    listen 443 ssl;
    server_name logs.makkib.com;

    ssl_certificate     /etc/letsencrypt/live/logs.makkib.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/logs.makkib.com/privkey.pem;

    # MCP endpoint — Streamable HTTP (POST only in stateless mode)
    location /mcp {
        proxy_pass http://127.0.0.1:3850/mcp;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:3850/health;
    }

    # Block everything else
    location / {
        return 404;
    }
}
