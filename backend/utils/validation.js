const isValidUrlValue = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_error) {
    return false;
  }
};

const isValidBase64ImageValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return false;

  const dataUrlRegex = /^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=\s]+$/;
  if (dataUrlRegex.test(raw)) return true;

  const plainBase64Regex = /^[A-Za-z0-9+/=\s]+$/;
  return plainBase64Regex.test(raw) && raw.replace(/\s+/g, '').length > 80;
};

const isValidPhotoValue = (value) => isValidUrlValue(value) || isValidBase64ImageValue(value);

module.exports = {
  isValidUrlValue,
  isValidBase64ImageValue,
  isValidPhotoValue,
};
