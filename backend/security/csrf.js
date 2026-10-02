const crypto = require('node:crypto');
const config = require('../config');

function createCsrfToken(sessionId) {
  return crypto.createHmac('sha256', config.auth.csrfSecret).update(sessionId, 'utf8').digest('base64url');
}

function verifyCsrfToken(sessionId, candidate) {
  if (typeof candidate !== 'string') return false;
  const expected = createCsrfToken(sessionId);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const candidateBuffer = Buffer.from(candidate, 'utf8');
  return candidateBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(candidateBuffer, expectedBuffer);
}

module.exports = { createCsrfToken, verifyCsrfToken };
