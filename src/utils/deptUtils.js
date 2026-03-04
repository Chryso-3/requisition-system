/**
 * Maps full department names to their respective abbreviations for table display.
 */
const DEPT_MAP = {
  'OFFICE OF GENERAL MANAGER': 'OGM',
  'FINANCE SERVICES DEPARTMENT': 'FSD',
  'INSTITUTIONAL SERVICES DEPARTMENT': 'ISD',
  'TECHNICAL SERVICES DEPARTMENT': 'TSD',
}

/**
 * Returns the abbreviation for a given department name.
 * If no mapping exists, returns the original name.
 * @param {string} name - The full department name
 * @returns {string} - The abbreviation or original name
 */
export function getDeptAbbreviation(name) {
  if (!name) return '—'
  const upper = name.trim().toUpperCase()
  return DEPT_MAP[upper] || name
}
