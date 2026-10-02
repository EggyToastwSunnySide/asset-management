const { checkBody, validationError } = require('../validation');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(raw) {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

function parseSignIn(body) {
  const c = checkBody(body, ['email', 'password']);
  const email = normalizeEmail(body.email);
  if (!email) c.fail('email', 'Must be a valid email address');
  if (typeof body.password !== 'string' || body.password.length === 0) {
    c.fail('password', 'Required');
  } else if (Array.from(body.password).length > 128) {
    c.fail('password', 'Must be at most 128 characters');
  }
  c.done();
  return { email, password: body.password };
}

function validateProvisioningInput({ email, displayName, password }) {
  const fields = {};
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) fields.email = 'Must be a valid email address';
  if (typeof displayName !== 'string' || displayName.trim() === '') fields.displayName = 'Required';
  else if (displayName.trim().length > 255) fields.displayName = 'Must be at most 255 characters';
  if (typeof password !== 'string') fields.password = 'Required';
  else {
    const length = Array.from(password).length;
    if (length < 12 || length > 128) fields.password = 'Must be between 12 and 128 characters';
  }
  if (Object.keys(fields).length) throw validationError(fields);
  return { email: normalizedEmail, displayName: displayName.trim(), password };
}

module.exports = { normalizeEmail, parseSignIn, validateProvisioningInput };
