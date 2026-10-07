const { randomUUID } = require('node:crypto');

function createId(prefix) {
  return prefix ? `${prefix}_${randomUUID()}` : randomUUID();
}

module.exports = { createId };
