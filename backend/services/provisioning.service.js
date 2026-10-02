const { validateProvisioningInput } = require('../api/dto/auth.dto');
const { createProvisionedUser } = require('../repositories/users.repo');
const { hashPassword } = require('../security/passwords');

async function provisionUser(input) {
  const value = validateProvisioningInput(input);
  const passwordHash = await hashPassword(value.password);
  return createProvisionedUser({
    email: value.email,
    displayName: value.displayName,
    passwordHash,
    bootstrapAdmin: Boolean(input.bootstrapAdmin),
  });
}

module.exports = { provisionUser };
