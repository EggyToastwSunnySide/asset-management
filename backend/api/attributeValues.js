/**
 * Custom attribute values (US18-T6): validates an asset's `extendedAttributes`
 * against its type's attribute definitions and returns the object to store in
 * `assets.extended_attributes`. Shared with the asset form's checks (US19-T3).
 *
 * Hidden attributes (`is_active = false`) are not the client's to edit: their
 * stored values are carried over whatever the client sends, because a PUT is a
 * full replacement (ADR-0004) and would otherwise delete them.
 */

const { Checker, isBlank } = require('./validation');

const READERS = {
  text: (c, key) => c.string(key, { max: 2000 }),
  number: (c, key) => c.number(key),
  date: (c, key) => c.date(key),
  boolean: (c, key) => c.boolean(key),
};

/**
 * @param input       the client's `{ [key]: value }` object
 * @param definitions the type's attribute rows: `{ key, data_type, is_required, is_active }`, hidden ones included
 * @param stored      the asset's current values; `{}` on create and when the type changes
 * @returns the values to store; throws a 422 with `fields["extendedAttributes.<key>"]`
 */
function validateExtendedAttributes(input, definitions, stored = {}) {
  const c = new Checker(input, { path: 'extendedAttributes', allowed: definitions.map((d) => d.key) });
  const values = {};
  for (const { key, data_type: dataType, is_required: isRequired, is_active: isActive } of definitions) {
    if (!isActive) {
      if (stored[key] !== undefined) values[key] = stored[key];
    } else if (isBlank(input[key])) {
      if (isRequired) c.fail(key, 'Required');
    } else {
      const value = READERS[dataType](c, key);
      if (value !== undefined) values[key] = value;
    }
  }
  return c.done(values);
}

module.exports = { validateExtendedAttributes };
