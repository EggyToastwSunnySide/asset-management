const argon2 = require('argon2');
const config = require('../config');

const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=19456,p=1,t=2$IrqNUXGRArG6e/NPTU0E9g$4EXT1yNJ8PAvADgPa5QnHfqwGl7teD2T16aZsF0YGas';

function validatePassword(password) {
  if (typeof password !== 'string') return 'Password must be a string';
  const length = Array.from(password).length;
  if (length < 12 || length > 128) return 'Password must be between 12 and 128 characters';
  return null;
}

function hashPassword(password) {
  const error = validatePassword(password);
  if (error) throw new TypeError(error);
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: config.auth.password.memoryCost,
    timeCost: config.auth.password.timeCost,
    parallelism: config.auth.password.parallelism,
    hashLength: config.auth.password.hashLength,
  });
}

async function verifyPassword(passwordHash, password) {
  const hash = passwordHash || DUMMY_PASSWORD_HASH;
  try {
    return await argon2.verify(hash, password, { type: argon2.argon2id });
  } catch {
    if (hash !== DUMMY_PASSWORD_HASH) {
      await argon2.verify(DUMMY_PASSWORD_HASH, password, { type: argon2.argon2id }).catch(() => false);
    }
    return false;
  }
}

module.exports = { DUMMY_PASSWORD_HASH, hashPassword, validatePassword, verifyPassword };
