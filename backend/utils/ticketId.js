const PREFIX = 'MAU';
const LEGACY_PREFIX = 'TK';

function displayTicketId(stored) {
  if (stored == null || String(stored).trim() === '') return null;
  return String(stored).replace(new RegExp(`^${LEGACY_PREFIX}-`, 'i'), `${PREFIX}-`);
}

function displayTicketText(text) {
  if (text == null) return text;
  return String(text).replace(new RegExp(`${LEGACY_PREFIX}-(\\d+)`, 'g'), `${PREFIX}-$1`);
}

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ticketCodeMatchQuery(input) {
  const raw = String(input || '').trim().toLowerCase().replace(/\s+/g, '');
  const numeric = raw.replace(/^(mau|tk)-/, '');
  if (!numeric) return null;
  return { $regex: new RegExp(`^(?:mau|tk)-${escapeRegex(numeric)}$`, 'i') };
}

module.exports = { displayTicketId, displayTicketText, ticketCodeMatchQuery };