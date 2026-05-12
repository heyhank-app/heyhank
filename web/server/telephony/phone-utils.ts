// ─── Phone number normalization ──────────────────────────────────────────────
// Inbound SIP providers vary in how they present the caller number:
//   peoplefone (AT): "06508920611"           → national format with leading 0
//   sipgate (DE):    "+4915112345678"        → already E.164
//   some legacy:     "004915112345678"       → "00" international prefix
// Contacts are stored in E.164 (e.g. "+436508920611"). Without normalization,
// the inbound caller-ID lookup fails to match a known contact, and Hank treats
// the caller as anonymous.

/**
 * Normalize a phone number to E.164 (`+<country><subscriber>`).
 * `defaultCountryCode` is the digit-only country code to assume when the input
 * uses national format (leading "0"). If empty, leading "0" is preserved and
 * the function returns the raw digits — callers should treat that as best-effort.
 */
export function normalizePhoneE164(num: string, defaultCountryCode: string = ""): string {
  if (!num) return "";
  // Keep digits and a leading + only
  const stripped = num.trim().replace(/[^\d+]/g, "");
  if (!stripped) return "";
  // Already E.164
  if (stripped.startsWith("+")) return stripped;
  // International prefix "00…" → "+…"
  if (stripped.startsWith("00")) return "+" + stripped.slice(2);
  // National format "0…" → "+<cc>…" if we know the country code
  if (stripped.startsWith("0") && defaultCountryCode) {
    return "+" + defaultCountryCode + stripped.slice(1);
  }
  // Bare digits — assume the caller already included the country code (e.g. peoplefone
  // sometimes sends "43720271025" without the +).
  return "+" + stripped;
}

/**
 * Pull the country-code digits ("43") out of a configured caller-ID like "+43720271025".
 * E.164 country codes are 1-3 digits; we match against a known prefix list (longest-first)
 * because a naive `\d{1,3}` regex is greedy and would return "437" for "+43720271025".
 */
const KNOWN_COUNTRY_CODES = [
  // 3-digit
  "350", "351", "352", "353", "354", "355", "356", "357", "358", "359",
  "370", "371", "372", "373", "374", "375", "376", "377", "378", "380",
  "381", "382", "383", "385", "386", "387", "389",
  "420", "421", "423",
  // 2-digit
  "20", "27", "30", "31", "32", "33", "34", "36", "39", "40", "41", "43", "44",
  "45", "46", "47", "48", "49", "51", "52", "53", "54", "55", "56", "57", "58",
  "60", "61", "62", "63", "64", "65", "66", "81", "82", "84", "86", "90", "91",
  "92", "93", "94", "95", "98",
  // 1-digit
  "1", "7",
];
export function extractCountryCode(callerId: string | undefined | null): string {
  if (!callerId) return "";
  const m = callerId.trim().match(/^\+(\d+)/);
  if (!m) return "";
  const digits = m[1];
  // Match longest known prefix first (3 → 2 → 1)
  for (const cc of KNOWN_COUNTRY_CODES) {
    if (digits.startsWith(cc)) return cc;
  }
  return "";
}
