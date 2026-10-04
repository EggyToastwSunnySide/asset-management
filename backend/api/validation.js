/**
 * Minimal DTO validation toolkit (ADR-0005). A DTO module opens a `Checker`
 * over the raw input, reads each field through it, and calls `done()`, which
 * throws a single 422 carrying every per-field message — so a form can mark
 * all of its bad fields from one response.
 */

const { ApiError } = require('./errors');

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlank(raw) {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '');
}

class Checker {
  /**
   * @param input   the object being validated
   * @param path    prefix for error keys of nested objects, e.g. 'filters'
   * @param allowed when given, any other key is reported as an unknown field
   */
  constructor(input, { path = '', allowed } = {}) {
    this.input = input;
    this.path = path;
    this.errors = {};
    if (allowed) {
      for (const key of Object.keys(input)) {
        if (!allowed.includes(key)) this.fail(key, 'Unknown field');
      }
    }
  }

  key(name) {
    return this.path ? this.path + '.' + name : name;
  }

  /** Records the first message for a field and returns undefined, so `return this.fail(...)` reads naturally. */
  fail(name, message) {
    const key = this.key(name);
    if (!this.errors[key]) this.errors[key] = message;
    return undefined;
  }

  has(name) {
    return this.input[name] !== undefined && this.input[name] !== null;
  }

  /** Trimmed string. When not `required`, a missing or blank value yields `fallback`. */
  string(name, { required = true, max = 255, pattern, patternMessage, fallback } = {}) {
    const raw = this.input[name];
    if (isBlank(raw)) return required ? this.fail(name, 'Required') : fallback;
    if (typeof raw !== 'string') return this.fail(name, 'Must be a string');
    const value = raw.trim();
    if (value.length > max) return this.fail(name, 'Must be at most ' + max + ' characters');
    if (pattern && !pattern.test(value)) return this.fail(name, patternMessage || 'Invalid format');
    return value;
  }

  /** Reference-data code: trimmed and upper-cased, the same shape the schema's CHECKs enforce. */
  code(name, { required = true } = {}) {
    const value = this.string(name, { required, max: 32 });
    if (value === undefined) return undefined;
    const code = value.toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) return this.fail(name, 'Must be a code such as LAPTOP');
    return code;
  }

  /**
   * One code or a list of them — a query string repeats the key
   * (`type=A&type=B`), a JSON body sends an array. Always returns an array
   * (possibly empty) of unique, upper-cased codes, or undefined on error.
   */
  codes(name, { max = 50 } = {}) {
    const raw = this.input[name];
    if (isBlank(raw)) return [];
    const list = Array.isArray(raw) ? raw : [raw];
    if (list.length > max) return this.fail(name, 'At most ' + max + ' values');
    const out = new Set();
    for (const item of list) {
      if (typeof item !== 'string' || !/^[A-Za-z0-9_-]{1,32}$/.test(item.trim())) {
        return this.fail(name, 'Must be a code, or a list of codes, such as LAPTOP');
      }
      out.add(item.trim().toUpperCase());
    }
    return [...out];
  }

  oneOf(name, values, { required = true, fallback } = {}) {
    const raw = this.input[name];
    if (isBlank(raw)) return required ? this.fail(name, 'Required') : fallback;
    if (!values.includes(raw)) return this.fail(name, 'Must be one of: ' + values.join(', '));
    return raw;
  }

  /** Calendar date as 'YYYY-MM-DD'; rejects impossible dates such as 2024-02-30. */
  date(name, { required = true } = {}) {
    const value = this.string(name, {
      required,
      max: 10,
      pattern: /^\d{4}-\d{2}-\d{2}$/,
      patternMessage: 'Must be a date as YYYY-MM-DD',
    });
    if (value === undefined) return undefined;
    const [y, m, d] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(y, m - 1, d));
    if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() !== m - 1 || parsed.getUTCDate() !== d) {
      return this.fail(name, 'Not a real calendar date');
    }
    return value;
  }

  /** Integer; numeric strings are accepted because query parameters arrive as strings. */
  integer(name, { min, max, fallback } = {}) {
    const raw = this.input[name];
    if (isBlank(raw)) return fallback;
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(value)) return this.fail(name, 'Must be a whole number');
    if (min !== undefined && value < min) return this.fail(name, 'Must be at least ' + min);
    if (max !== undefined && value > max) return this.fail(name, 'Must be at most ' + max);
    return value;
  }

  boolean(name) {
    const raw = this.input[name];
    if (typeof raw !== 'boolean') return this.fail(name, 'Must be true or false');
    return raw;
  }

  /** Finite JSON number; unlike `integer`, a numeric string is rejected — JSON bodies only. */
  number(name) {
    const raw = this.input[name];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return this.fail(name, 'Must be a number');
    return raw;
  }

  /**
   * Nested object validated by `validate(childChecker)`; the child's errors
   * merge into this one. An optional object that is missing is validated as
   * `{}`, so the child's own defaults apply.
   */
  object(name, validate, { required = true, allowed } = {}) {
    let raw = this.input[name];
    if (raw === undefined || raw === null) {
      if (required) return this.fail(name, 'Required');
      raw = {};
    }
    if (!isPlainObject(raw)) return this.fail(name, 'Must be an object');
    const child = new Checker(raw, { path: this.key(name), allowed });
    const value = validate(child);
    Object.assign(this.errors, child.errors);
    return value;
  }

  get ok() {
    return Object.keys(this.errors).length === 0;
  }

  /** Throws the collected field errors, or returns `value` when there are none. */
  done(value) {
    if (!this.ok) throw validationError(this.errors);
    return value;
  }
}

function validationError(fields, message = 'Some fields are invalid') {
  return new ApiError(422, 'VALIDATION_FAILED', message, fields);
}

/** Entry point for a JSON body: it must be an object, and unknown keys are rejected. */
function checkBody(body, allowed) {
  if (!isPlainObject(body)) {
    throw new ApiError(400, 'INVALID_BODY', 'Request body must be a JSON object');
  }
  return new Checker(body, { allowed });
}

/** Entry point for a query string: unknown parameters are ignored, not rejected. */
function checkQuery(query) {
  return new Checker(query || {});
}

module.exports = { Checker, checkBody, checkQuery, validationError, isPlainObject, isBlank };
