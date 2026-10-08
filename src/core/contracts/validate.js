'use strict';

/*
 * Minimal JSON-Schema subset validator (no dependencies, no code generation).
 * It supports exactly the keywords the JobScope contracts use, so the published
 * schemas stop being decorative: payloads are validated against them.
 */

const TYPES = {
  object: value => value !== null && typeof value === 'object' && !Array.isArray(value),
  array: value => Array.isArray(value),
  string: value => typeof value === 'string',
  number: value => typeof value === 'number' && Number.isFinite(value),
  integer: value => Number.isInteger(value),
  boolean: value => typeof value === 'boolean',
  null: value => value === null
};

function matchesType(value, type) {
  const check = TYPES[type];
  return check ? check(value) : false;
}

function validate(value, schema, path = '$') {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path}: expected constant ${JSON.stringify(schema.const)}`);
    return errors;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some(candidate => candidate === value)) {
    errors.push(`${path}: value is not one of ${schema.enum.join(', ')}`);
    return errors;
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some(type => matchesType(value, type))) {
      errors.push(`${path}: expected ${types.join('|')}, received ${value === null ? 'null' : typeof value}`);
      return errors;
    }
  }

  if (typeof value === 'string') {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) errors.push(`${path}: not a date-time`);
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: below minimum ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) errors.push(`${path}: above maximum ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    if (schema.items) value.forEach((item, index) => errors.push(...validate(item, schema.items, `${path}[${index}]`)));
  }
  if (matchesType(value, 'object')) {
    for (const required of schema.required || []) {
      if (!(required in value)) errors.push(`${path}: missing required property "${required}"`);
    }
    for (const [key, subschema] of Object.entries(schema.properties || {})) {
      if (key in value) errors.push(...validate(value[key], subschema, `${path}.${key}`));
    }
  }
  return errors;
}

function assertValid(value, schema, label = 'payload') {
  const errors = validate(value, schema);
  if (errors.length) {
    const error = new Error(`${label} violates ${schema.$id || 'contract'}: ${errors.slice(0, 5).join('; ')}`);
    error.code = 'CONTRACT_VIOLATION';
    error.errors = errors;
    throw error;
  }
  return value;
}

module.exports = { validate, assertValid };
