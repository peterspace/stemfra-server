-- lead_sms_consent_v1 — applied live 2026-09-04.
-- Stamped by POST /api/twilio/claim-sms when a rep clicks "Send Claim" during
-- a call (the click records the owner's verbal consent to be texted).
alter table leads add column if not exists sms_consent_at timestamptz;
