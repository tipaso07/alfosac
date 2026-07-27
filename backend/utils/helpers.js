const bcrypt = require('bcryptjs');
const { normalize } = require('./normalize');

const SQL_DEBUG_ENABLED = String(process.env.SQL_DEBUG || 'true').toLowerCase() !== 'false';

const compactSql = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const logSqlQuery = (origin, text, values) => {
  if (!SQL_DEBUG_ENABLED) return;
  const sqlText = typeof text === 'string' ? text : (text?.text || '');
  const sqlValues = Array.isArray(values) ? values : (Array.isArray(text?.values) ? text.values : []);
  console.log('[SQL][QUERY]', {
    origin,
    query: compactSql(sqlText),
    values: sqlValues,
  });
};

const parseBooleanFlag = (value, defaultValue = false) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value === 1;
  }

  const normalizedValue = normalize(value);
  if (['1', 'TRUE', 'VERDADERO', 'SI', 'S', 'YES', 'Y'].includes(normalizedValue)) {
    return true;
  }

  if (['0', 'FALSE', 'FALSO', 'NO', 'N'].includes(normalizedValue)) {
    return false;
  }

  return Boolean(defaultValue);
};

const parseReceiptInfo = (value) => {
  const text = String(value || '').trim();
  const match = text.match(/^(.*?)(?:\s*-\s*DNI\s*(.+))?$/i);
  const nombre = String(match?.[1] || '').trim();
  const dni = String(match?.[2] || '').trim();
  return {
    nombre: nombre || text,
    dni,
  };
};

const hashPassword = async (plainPassword) => {
  if (!plainPassword) return '';
  const cleaned = String(plainPassword).trim();
  if (!cleaned) return '';
  return bcrypt.hash(cleaned, 10);
};

module.exports = {
  SQL_DEBUG_ENABLED,
  compactSql,
  logSqlQuery,
  parseBooleanFlag,
  parseReceiptInfo,
  hashPassword,
};
