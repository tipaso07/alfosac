const PET_TIME_ZONE = 'America/Lima';
const PET_SQL_NOW = `timezone('${PET_TIME_ZONE}', now())`;

const formatPetDateTime = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: PET_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
};

const currentPetDateTime = () => formatPetDateTime(new Date());

module.exports = {
  PET_TIME_ZONE,
  PET_SQL_NOW,
  formatPetDateTime,
  currentPetDateTime,
};
