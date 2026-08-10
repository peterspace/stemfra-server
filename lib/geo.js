// Geo name → code helpers for the Compliance Engine's tax registry.
// contacts.country / contacts.state store HUMAN NAMES (the CMS LocationPicker
// emits names, not ISO codes). Nexus is tracked per US state, so we need a
// name → 2-letter code map to build stable jurisdiction keys ('US-NY').
// Independent copy on purpose (lib/airwallexBilling.js keeps its own country
// map; this module is the compliance-side source and adds US states).

const COUNTRY_ISO = {
  'united states': 'US', 'united states of america': 'US', usa: 'US', 'u.s.': 'US', 'u.s.a.': 'US',
  canada: 'CA', 'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB',
  australia: 'AU', nigeria: 'NG', ireland: 'IE', 'new zealand': 'NZ',
  germany: 'DE', france: 'FR', spain: 'ES', italy: 'IT', netherlands: 'NL',
  india: 'IN', 'south africa': 'ZA', mexico: 'MX', brazil: 'BR',
};

const US_STATE_CODE = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', 'district of columbia': 'DC',
  florida: 'FL', georgia: 'GA', hawaii: 'HI', idaho: 'ID', illinois: 'IL',
  indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA',
  maine: 'ME', maryland: 'MD', massachusetts: 'MA', michigan: 'MI', minnesota: 'MN',
  mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
};

const US_STATE_NAME = Object.fromEntries(Object.entries(US_STATE_CODE).map(([name, code]) => [code, name.replace(/\b\w/g, (c) => c.toUpperCase())]));

/** Country human-name → ISO-2 (or a passed-through 2-letter code). null if unmappable. */
function countryIso(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return COUNTRY_ISO[raw.toLowerCase()] || null;
}

/** US state human-name → 2-letter code (or a passed-through code). null if unmappable. */
function usStateCode(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  if (/^[A-Za-z]{2}$/.test(raw)) return raw.toUpperCase();
  return US_STATE_CODE[raw.toLowerCase()] || null;
}

/**
 * Resolve a contact's country/state (human names) into a stable jurisdiction
 * key + display label for the tax registry.
 *  - US with a known state → { jurisdiction:'US-NY', label:'New York', country:'US' }
 *  - US, unknown/blank state → { jurisdiction:'US-??', label:'United States (state unknown)', country:'US' }
 *  - non-US → { jurisdiction:'NG', label:'Nigeria', country:'NG' }
 *  - unmappable → { jurisdiction:'UNKNOWN', label:'Unknown', country:null }
 */
function jurisdictionFor(country, state) {
  const iso = countryIso(country);
  if (iso === 'US') {
    const code = usStateCode(state);
    if (code) return { jurisdiction: `US-${code}`, label: US_STATE_NAME[code] || code, country: 'US' };
    return { jurisdiction: 'US-??', label: 'United States (state unknown)', country: 'US' };
  }
  if (iso) {
    const label = String(country || '').trim() || iso;
    return { jurisdiction: iso, label: label.replace(/\b\w/g, (c) => c.toUpperCase()), country: iso };
  }
  return { jurisdiction: 'UNKNOWN', label: 'Unknown', country: null };
}

module.exports = { countryIso, usStateCode, jurisdictionFor, US_STATE_CODE, US_STATE_NAME };
