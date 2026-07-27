const normalize = (v) => String(v || '').trim().toUpperCase();
const normalizeRoleName = (value) => normalize(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const normalizePermissionName = (value) => normalizeRoleName(value)
  .replace(/[^A-Z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

module.exports = {
  normalize,
  normalizeRoleName,
  normalizePermissionName,
};
