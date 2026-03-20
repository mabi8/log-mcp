import { execSync } from 'child_process';

export interface LogEntry {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  fields: Record<string, unknown>;
  _raw?: string;
}

export interface QueryOptions {
  service?: string;
  since?: string;       // e.g. "1 hour ago", "2025-03-20 10:00:00", "today"
  until?: string;
  level?: string;       // emerg, alert, crit, err, warning, notice, info, debug
  grep?: string;        // full-text search
  lines?: number;       // max lines to return (default 50)
  reverse?: boolean;    // newest first (default true)
}

const KNOWN_SERVICES = ['bcl-telegram', 'mcp-centerdevice', 'mcp-bidrento', 'bcl-wa-bot', 'log-mcp'];

const PRIORITY_MAP: Record<string, number> = {
  emerg: 0, alert: 1, crit: 2, err: 3,
  warning: 4, notice: 5, info: 6, debug: 7,
};

const PRIORITY_NAMES: Record<string, string> = {
  '0': 'emerg', '1': 'alert', '2': 'crit', '3': 'err',
  '4': 'warning', '5': 'notice', '6': 'info', '7': 'debug',
};

export function queryLogs(opts: QueryOptions): LogEntry[] {
  const args: string[] = ['journalctl', '--output=json', '--no-pager'];

  if (opts.service) {
    // Support comma-separated services
    const services = opts.service.split(',').map(s => s.trim());
    for (const svc of services) {
      args.push(`-u`, `${svc}.service`);
    }
  }

  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.until) args.push(`--until=${opts.until}`);

  if (opts.level) {
    const prio = PRIORITY_MAP[opts.level.toLowerCase()];
    if (prio !== undefined) {
      args.push(`-p`, String(prio));
    }
  }

  if (opts.grep) {
    args.push(`--grep=${opts.grep}`);
  }

  const lines = opts.lines || 50;
  args.push(`-n`, String(Math.min(lines, 500))); // cap at 500 to avoid context overflow

  if (opts.reverse !== false) {
    args.push('--reverse');
  }

  try {
    const output = execSync(args.join(' '), {
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 5 * 1024 * 1024, // 5MB
    });

    return output
      .trim()
      .split('\n')
      .filter(line => line.length > 0)
      .map(line => parseJournaldJson(line))
      .filter((entry): entry is LogEntry => entry !== null);
  } catch (err: any) {
    // journalctl returns exit code 1 when no matches found
    if (err.status === 1 && (!err.stdout || err.stdout.trim() === '')) {
      return [];
    }
    throw new Error(`journalctl failed: ${err.message}`);
  }
}

function parseJournaldJson(line: string): LogEntry | null {
  try {
    const j = JSON.parse(line);

    // Try to parse the MESSAGE as JSON (structured logging)
    let parsedMessage: Record<string, unknown> = {};
    let messageText = j.MESSAGE || '';
    try {
      const parsed = JSON.parse(messageText);
      if (typeof parsed === 'object' && parsed !== null) {
        parsedMessage = parsed;
        messageText = parsed.message || parsed.msg || messageText;
      }
    } catch {
      // Not JSON, use raw message
    }

    const priority = j.PRIORITY || '6';

    return {
      timestamp: j.__REALTIME_TIMESTAMP
        ? new Date(Number(j.__REALTIME_TIMESTAMP) / 1000).toISOString()
        : new Date().toISOString(),
      service: j.SYSLOG_IDENTIFIER || j._SYSTEMD_UNIT || 'unknown',
      level: PRIORITY_NAMES[priority] || 'info',
      message: String(messageText),
      fields: {
        ...parsedMessage,
        pid: j._PID,
        unit: j._SYSTEMD_UNIT,
      },
    };
  } catch {
    return null;
  }
}

export interface ServiceHealth {
  service: string;
  active: boolean;
  uptime?: string;
  errorCount24h: number;
  warningCount24h: number;
  lastError?: LogEntry;
  lastRestart?: string;
}

export function getServiceHealth(service?: string): ServiceHealth[] {
  const services = service ? [service] : KNOWN_SERVICES;
  const results: ServiceHealth[] = [];

  for (const svc of services) {
    // Check if systemd unit is active
    let active = false;
    let uptime: string | undefined;
    let lastRestart: string | undefined;

    try {
      const status = execSync(
        `systemctl is-active ${svc}.service 2>/dev/null || echo inactive`,
        { encoding: 'utf-8', timeout: 5000 }
      ).trim();
      active = status === 'active';

      if (active) {
        const sinceStr = execSync(
          `systemctl show ${svc}.service --property=ActiveEnterTimestamp --value 2>/dev/null`,
          { encoding: 'utf-8', timeout: 5000 }
        ).trim();
        if (sinceStr) {
          lastRestart = sinceStr;
          const since = new Date(sinceStr);
          const diff = Date.now() - since.getTime();
          const hours = Math.floor(diff / 3600000);
          const days = Math.floor(hours / 24);
          uptime = days > 0 ? `${days}d ${hours % 24}h` : `${hours}h`;
        }
      }
    } catch {
      // Service might not have a systemd unit with that exact name
    }

    // Count errors and warnings in last 24h
    const errors = queryLogs({ service: svc, since: '24 hours ago', level: 'err', lines: 500 });
    const warnings = queryLogs({ service: svc, since: '24 hours ago', level: 'warning', lines: 500 });

    results.push({
      service: svc,
      active,
      uptime,
      errorCount24h: errors.length,
      warningCount24h: warnings.length,
      lastError: errors.length > 0 ? errors[0] : undefined,
      lastRestart,
    });
  }

  return results;
}

export function getKnownServices(): string[] {
  return [...KNOWN_SERVICES];
}
