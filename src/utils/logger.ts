/**
 * Minimal leveled structured logger.
 *
 * Replaces scattered `console.log` calls that emitted ~25 pretty-printed JSON
 * lines per eBay call (~7,300 lines/day for two monitors; ~365,000/day at 100).
 * Three problems with that: `console.log` to a pipe is synchronous and blocks
 * the event loop, `JSON.stringify(x, null, 2)` re-serialises with indentation
 * on every call, and the volume made the Railway log search unusable.
 *
 * One line per event, machine-parseable, gated by LOG_LEVEL (default: info in
 * production, debug elsewhere). No dependency: pino would be the natural
 * upgrade if async transports or redaction rules are ever needed.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function resolveLevel(): LogLevel {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && configured in LEVELS) {
    return configured as LogLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const activeLevel = LEVELS[resolveLevel()];

/**
 * Fields that must never reach the logs. Guards against a whole object being
 * passed through (e.g. an axios error carrying request headers), which is how
 * the eBay bearer token used to end up in production logs.
 */
const REDACTED_KEYS = new Set([
  'authorization',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'password',
  'secret',
  'clientsecret',
  'client_secret',
  'token',
  'verificationtoken',
  'verificationpin',
  'cookie',
]);

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((v) => sanitize(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k.toLowerCase())
        ? '[redacted]'
        : sanitize(v, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < activeLevel) return;

  const record = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...(fields ? (sanitize(fields) as Record<string, unknown>) : {}),
  };

  // Single line, no indentation. stderr for warn/error so platforms that
  // separate the streams classify them correctly.
  const line = JSON.stringify(record);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => emit('debug', message, fields),
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
  /** True when debug output would actually be emitted; guard expensive payload building. */
  isDebug: () => LEVELS.debug >= activeLevel,
};
