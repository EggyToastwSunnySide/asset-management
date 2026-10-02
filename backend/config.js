function integer(name, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a whole number`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return value;
}

function boolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function origins() {
  const raw = process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:8080';
  const values = raw.split(',').map((value) => value.trim()).filter(Boolean);
  if (!values.length) throw new Error('ALLOWED_ORIGINS must contain at least one origin');
  return values.map((value) => {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid origin: ${value}`);
    }
    if (url.origin !== value || !['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`ALLOWED_ORIGINS entries must be exact HTTP(S) origins: ${value}`);
    }
    return value;
  });
}

const environment = process.env.NODE_ENV || 'development';
const production = environment === 'production';
const allowedOrigins = origins();
const csrfSecret = process.env.CSRF_SECRET || 'local-development-csrf-secret-change-before-production';
const secureCookie = boolean('COOKIE_SECURE', production);
const sessionIdleTtlSeconds = integer('SESSION_IDLE_TTL_SECONDS', 30 * 60, { max: 30 * 24 * 60 * 60 });
const sessionAbsoluteTtlSeconds = integer('SESSION_ABSOLUTE_TTL_SECONDS', 12 * 60 * 60, {
  max: 90 * 24 * 60 * 60,
});

if (sessionAbsoluteTtlSeconds < sessionIdleTtlSeconds) {
  throw new Error('SESSION_ABSOLUTE_TTL_SECONDS must be at least SESSION_IDLE_TTL_SECONDS');
}
if (csrfSecret.length < 32) throw new Error('CSRF_SECRET must contain at least 32 characters');

if (production) {
  const placeholders = new Set([
    'local-development-csrf-secret-change-before-production',
    'change-me',
    'change-me-in-local-env',
  ]);
  if (placeholders.has(csrfSecret)) throw new Error('CSRF_SECRET must be replaced in production');
  if (!secureCookie) throw new Error('COOKIE_SECURE must be true in production');
  for (const origin of allowedOrigins) {
    if (!origin.startsWith('https://')) throw new Error('Production ALLOWED_ORIGINS must use HTTPS');
  }
}

module.exports = {
  environment,
  production,
  port: process.env.PORT || '3000',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: integer('DB_PORT', 5432, { max: 65535 }),
    database: process.env.DB_NAME || 'asset_management',
    user: process.env.DB_USER || 'asset_app',
    password: process.env.DB_PASSWORD || 'asset_app_dev',
    max: integer('DB_POOL_MAX', 10, { max: 100 }),
  },
  auth: {
    allowedOrigins,
    csrfSecret,
    cookie: {
      name: production ? '__Host-asset_session' : 'asset_session',
      secure: secureCookie,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    },
    session: {
      idleTtlSeconds: sessionIdleTtlSeconds,
      absoluteTtlSeconds: sessionAbsoluteTtlSeconds,
      touchIntervalSeconds: integer('SESSION_TOUCH_INTERVAL_SECONDS', 60, {
        min: 0,
        max: sessionIdleTtlSeconds,
      }),
      retentionSeconds: integer('SESSION_RETENTION_SECONDS', 7 * 24 * 60 * 60, {
        min: 0,
        max: 365 * 24 * 60 * 60,
      }),
      cleanupIntervalSeconds: integer('SESSION_CLEANUP_INTERVAL_SECONDS', 60 * 60, {
        min: 60,
        max: 24 * 60 * 60,
      }),
    },
    password: {
      memoryCost: integer('ARGON2_MEMORY_COST', 19456, { min: production ? 19456 : 8192, max: 1048576 }),
      timeCost: integer('ARGON2_TIME_COST', 2, { min: production ? 2 : 1, max: 10 }),
      parallelism: integer('ARGON2_PARALLELISM', 1, { max: 16 }),
      hashLength: integer('ARGON2_HASH_LENGTH', 32, { min: 16, max: 64 }),
    },
    rateLimit: {
      signInWindowMs: integer('SIGN_IN_RATE_LIMIT_WINDOW_SECONDS', 15 * 60, { max: 24 * 60 * 60 }) * 1000,
      signInMax: integer('SIGN_IN_RATE_LIMIT_MAX', 10, { max: 10000 }),
      apiWindowMs: integer('API_RATE_LIMIT_WINDOW_SECONDS', 60, { max: 24 * 60 * 60 }) * 1000,
      apiMax: integer('API_RATE_LIMIT_MAX', 1000, { max: 100000 }),
    },
    lockout: {
      maxFailures: integer('AUTH_LOCKOUT_MAX_FAILURES', 10, { min: 1, max: 1000 }),
      windowSeconds: integer('AUTH_LOCKOUT_WINDOW_SECONDS', 15 * 60, { max: 24 * 60 * 60 }),
      durationSeconds: integer('AUTH_LOCKOUT_SECONDS', 15 * 60, { max: 30 * 24 * 60 * 60 }),
    },
  },
};
