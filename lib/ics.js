// Booking .ics attachments (Calendly-gap work, 2026-08-09). The confirmation
// email carries the appointment as a universal calendar file: one tap puts
// "Haircut at Argyle & Sons, 2:00 PM" on the customer's phone calendar with a
// reminder — an in-person no-show reducer that needs no Google account and no
// video anything. METHOD:PUBLISH = a plain "add to calendar" file, not a
// meeting request (no RSVP round-trip).
function esc(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// ICS wants UTC basic format: 20260818T150000Z
function utc(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Minimal, universally-parseable VEVENT (Apple/Google/Outlook tested shapes).
 * Includes a 1 hour display reminder.
 * @returns {{ filename: string, content: Buffer }} ready for lib/mailer attachments
 */
function buildBookingIcsAttachment({ uid, summary, description, location, startIso, endIso }) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Stemfra//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@stemfra.com`,
    `DTSTAMP:${utc(new Date().toISOString())}`,
    `DTSTART:${utc(startIso)}`,
    `DTEND:${utc(endIso)}`,
    `SUMMARY:${esc(summary)}`,
    description ? `DESCRIPTION:${esc(description)}` : null,
    location ? `LOCATION:${esc(location)}` : null,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(summary)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return { filename: 'appointment.ics', content: Buffer.from(lines.join('\r\n'), 'utf8') };
}

module.exports = { buildBookingIcsAttachment };
