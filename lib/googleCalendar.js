// Reusable Google Calendar + Meet integration for STAFF scheduling (P12 §3 setup
// calls; later reused by a tenant-facing video-appointment feature). It uses the
// SAME service account + domain-wide delegation as lib/gmailOutreach.js, but that
// SA must ALSO be authorized for the Calendar scopes below in admin.google.com
// (Security → API controls → Domain-wide Delegation → the SA client ID → add the
// two CAL_SCOPES). It impersonates SETUP_CALL_HOST_EMAIL — a real Workspace user
// whose calendar hosts the calls (e.g. peter@stemfra.com or a dedicated
// calls@stemfra.com). Raw REST over the JWT access token — no googleapis dep.
const { JWT } = require('google-auth-library');
const crypto = require('crypto');

// Least-privilege: write/read events + read for the free/busy query.
const CAL_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.readonly',
];

/** The Workspace identity whose calendar hosts setup calls (the SA impersonates
 *  it). Defaults to MARK_EMAIL — the SA is already delegated for that mailbox
 *  (outreach), so only the Calendar SCOPE needs adding, not a new identity. */
function hostEmail() {
  return process.env.SETUP_CALL_HOST_EMAIL || process.env.MARK_EMAIL || null;
}

/** True once the SA creds + a host identity are present. Endpoints degrade to a
 *  clear "not configured" response until then (and until Peter authorizes the scope). */
function isConfigured() {
  return !!(process.env.GOOGLE_SA_CLIENT_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY && hostEmail());
}

async function accessToken(subject, scopes = CAL_SCOPES) {
  const jwt = new JWT({
    email: process.env.GOOGLE_SA_CLIENT_EMAIL,
    key: (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    scopes,
    subject,
  });
  const { access_token } = await jwt.authorize();
  return access_token;
}

async function calFetch(path, { method = 'GET', body, subject, query } = {}) {
  const token = await accessToken(subject);
  const url = new URL(`https://www.googleapis.com/calendar/v3${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  // 204 (DELETE) has no JSON body.
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Calendar ${method} ${path}: ${data.error?.message || res.status}`);
  return data;
}

/**
 * Merged busy blocks across one or more calendars within [timeMin, timeMax] (ISO).
 * The host (impersonated identity) must be able to see each calendar's free/busy
 * — inside one Workspace that's the default. A slot is "free" only if it overlaps
 * NONE of the returned blocks.
 * @returns {Promise<Array<{start:string,end:string}>>}
 */
async function queryFreeBusy({ timeMin, timeMax, calendarIds }) {
  const ids = (Array.isArray(calendarIds) ? calendarIds : [calendarIds]).filter(Boolean);
  if (!ids.length) return [];
  const data = await calFetch('/freeBusy', {
    method: 'POST', subject: hostEmail(),
    body: { timeMin, timeMax, items: ids.map(id => ({ id })) },
  });
  const cals = data.calendars || {};
  return ids.flatMap(id => cals[id]?.busy || []);
}

/**
 * Create a calendar event WITH a Google Meet link. Returns
 * { eventId, meetLink, htmlLink }.
 *
 * `sendUpdates` defaults to 'none' (2026-08-10, Peter's report): Google's own
 * invite email comes from the impersonated host (mark@stemfra.com), an address
 * the visitor has never corresponded with, so Gmail flags it "Invitation from
 * an unknown sender" and refuses to auto-add the event. Our OWN branded
 * confirmation email already carries the Meet link + an ICS attachment that
 * Gmail renders inline, so the Google-sent invite was redundant noise. The
 * event still lands on the host's calendar with the guest listed.
 */
async function createEventWithMeet({ summary, description, startIso, endIso, timeZone, attendees = [], calendarId = 'primary', sendUpdates = 'none' }) {
  const event = {
    summary,
    description,
    start: { dateTime: startIso, timeZone },
    end: { dateTime: endIso, timeZone },
    attendees: attendees.filter(a => a?.email).map(a => ({ email: a.email, displayName: a.name || undefined })),
    conferenceData: { createRequest: { requestId: 'stemfra-' + crypto.randomUUID(), conferenceSolutionKey: { type: 'hangoutsMeet' } } },
    reminders: { useDefault: true },
  };
  const data = await calFetch(`/calendars/${encodeURIComponent(calendarId)}/events`, {
    method: 'POST', subject: hostEmail(),
    query: { conferenceDataVersion: 1, sendUpdates },
    body: event,
  });
  const meetLink = data.hangoutLink
    || (data.conferenceData?.entryPoints || []).find(e => e.entryPointType === 'video')?.uri
    || null;
  return { eventId: data.id, meetLink, htmlLink: data.htmlLink || null };
}

/** Cancel an event. `sendUpdates` defaults to 'none' for the same
 *  unknown-sender reason as createEventWithMeet — our own cancellation email
 *  is the visitor-facing notice. Best-effort — callers can ignore failures. */
async function deleteEvent({ eventId, calendarId = 'primary', sendUpdates = 'none' }) {
  await calFetch(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {
    method: 'DELETE', subject: hostEmail(), query: { sendUpdates },
  });
}

module.exports = { CAL_SCOPES, isConfigured, hostEmail, queryFreeBusy, createEventWithMeet, deleteEvent };
