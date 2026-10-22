/**
 * Error envelope shared by every /api endpoint. The frontend's `apiClient`
 * parses exactly this shape, so keep the two in step:
 *
 *   { "error": { "code": "VALIDATION_FAILED", "message": "...", "fields": { "tag": "..." } } }
 *
 * `fields` is optional and carries per-field messages from DTO validation
 * (ADR-0005), keyed by the request body's field names.
 */

class ApiError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

/**
 * Express 4 does not catch rejected promises from handlers; this forwards
 * them to the error handler instead of leaving the request hanging.
 */
function asyncHandler(handler) {
  return function (req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `router.param` guard: a malformed id cannot name any row, so it is a 404,
 * not a database cast error.
 */
function uuidParam(resourceName) {
  return function (req, res, next, value) {
    if (!UUID.test(value)) return next(new ApiError(404, 'NOT_FOUND', resourceName + ' not found'));
    next();
  };
}

function notFound(req, res, next) {
  next(new ApiError(404, 'NOT_FOUND', 'No API route for ' + req.method + ' ' + req.originalUrl));
}

// Connection-level failures: the database is down, starting or unreachable.
const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EAI_AGAIN',
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now (starting up)
]);

function isDatabaseUnavailable(err) {
  return (
    DB_UNAVAILABLE_CODES.has(err.code) ||
    (typeof err.code === 'string' && err.code.startsWith('08')) || // connection_exception class
    /timeout exceeded when trying to connect/i.test(err.message || '')
  );
}

function normalize(err) {
  if (err instanceof ApiError) return err;
  // Malformed JSON bodies are rejected by express.json() before any route runs.
  if (err.type === 'entity.parse.failed') {
    return new ApiError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
  if (err.type === 'entity.too.large') {
    return new ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
  }
  if (isDatabaseUnavailable(err)) {
    return new ApiError(503, 'DATABASE_UNAVAILABLE', 'The database is unavailable. Try again shortly.');
  }
  return null;
}

// Express recognises an error handler by its four parameters, so `next` must stay.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const known = normalize(err);
  if (!known) console.error(err);
  else if (known.status >= 500) console.error(err.message);

  // Never leak internals of an unexpected failure to the client.
  const apiError = known || new ApiError(500, 'INTERNAL_ERROR', 'Internal server error');
  const body = { code: apiError.code, message: apiError.message };
  if (apiError.fields) body.fields = apiError.fields;

  res.status(apiError.status).json({ error: body });
}

module.exports = { ApiError, UUID, asyncHandler, uuidParam, notFound, errorHandler };
