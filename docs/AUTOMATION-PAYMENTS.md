# Automation and online payments

Migration `202611070501_automation_gateway.sql`, API `lib/automation-api.mjs`, pages `/automation/` and `/pay/`.

## What runs

A daily Vercel Cron (`/api/cron/automation`, 03:30 UTC = 09:00 IST, defined only in `vercel.json`; declaring it
again in the build output makes Vercel reject the deploy as a duplicate) does three things in order:

1. **Payment reminders.** For each business where the owner turned reminders on, every issued (`sent`) real
   invoice with a buyer email and an unpaid balance gets at most one reminder per configured offset (days after
   the due date). Only the largest offset reached is queued, so turning reminders on late does not send a burst.
   Dedupe key `reminder:<invoice>:<offset>`.
2. **Recurring invoices.** For each business where the owner turned recurring on, each active subscription whose
   `nextDate` has arrived produces a **draft** invoice through the existing `billing_generate_document` workflow
   (the same path as the manual "Generate invoice" action), catching up at most 12 missed periods per run. The
   owner gets an email to review taxes and customer details before issuing. Drafts are deliberate: GST invoices
   should not be issued without review.
3. **Email outbox delivery.** Queued emails are claimed under a 15-minute lease, sent through `lib/email.ts`
   (`sendEmail`, mock or Resend), and reported back. Failures back off 15 minutes per attempt and are marked
   `failed` after five attempts. The outbox id is the provider idempotency key, so an uncertain send is never
   duplicated.

Automation never touches demo records.

## Online payments

* Owners configure a provider per data mode. **Simulated gateway: demo data only.** A simulated receipt must never
  enter real books. **Razorpay:** paste the webhook secret and set the Razorpay webhook URL to
  `https://<your-domain>/api/gateway/webhook` with event `payment_link.paid`.
* Editors create a payment link for an issued invoice with a balance. The 64-hex token is shown once and stored
  only as SHA-256. The customer opens `/pay/#<token>`; the fragment never reaches servers or Referer headers.
* Every gateway event is verified in SQL with HMAC-SHA256 (`billing_hmac_sha256`, no extension needed) over the
  raw body, then recorded through `billing_record_payment`. It is deduplicated by provider payment id.
* Events that cannot be recorded are kept as `needs-review` with the reason, not posted. Reasons include amount
  above balance, currency mismatch, link no longer open, payments paused, or payment not captured.
* The simulated checkout signs a Razorpay-shaped event with the stored secret and sends it through the same
  verification path.
* **Real Razorpay checkout creation is not wired.** Creating hosted payment links through the Razorpay API needs
  a key id and secret on the server. Until those exist, creating a real-mode link returns a Reference ID (the Folio
  link id) instead of a Folio pay URL. The business creates the payment link in Razorpay with that Reference ID
  and sends it; the webhook records the payment. Real links are INR only, because Razorpay reports amounts in the
  currency's minor unit.
* Receipts are dated on the provider's capture day in the business time zone. If posting fails (for example the
  ledger period is closed), the verified event is still kept as `needs-review` with the reason.
* Reminders are re-checked when they are sent: cancelled if reminders were turned off or the invoice is settled,
  and re-worded if a part payment changed the balance. Outstanding amounts ignore future-dated receipts.
* A subscription that fails to generate backs off (1, 2, 3… up to 7 days) and is listed on the automation page,
  and each run takes at most 25 subscriptions per business so one business cannot hold the whole batch.

## Security model

There is no service-role key. Machine calls use only the publishable key and are authorised inside SQL:

* Cron RPCs (`billing_automation_due`, `billing_automation_generate`, `billing_automation_failed`,
  `billing_email_claim`, `billing_email_complete`) require the automation secret. Its SHA-256 is in `billing_system_secrets`, a table
  with RLS on, no policies and no grants.
* Webhooks require the business HMAC secret.
* After verification, work runs as the business owner for the rest of that transaction
  (`billing_act_as_owner`). That way the existing permission, ledger, numbering and outbox rules apply unchanged
  and audit rows name the owner.
* The access helpers, secret check and owner context functions are not executable by any API role.

## Activation checklist (operator)

1. Generate a secret: `openssl rand -hex 32`.
2. Save it in the database once, in the Supabase SQL editor:
   `insert into public.billing_system_secrets(name,secret_hash) values('automation',sha256(convert_to('<secret>','UTF8'))) on conflict(name) do update set secret_hash=excluded.secret_hash;`
3. Vercel project env: `FOLIO_AUTOMATION_SECRET=<secret>` and `CRON_SECRET=<another random value>`. Vercel sends
   the latter as a bearer token to the cron path.
4. Live email: set `RESEND_API_KEY` and `BILLING_EMAIL_FROM` and switch `providerMode` in
   `lib/product-config.mjs`. Until then every email is a labelled simulation and nothing leaves Folio.
5. Owners enable reminders, recurring drafts and online payments at `/automation/`.

## Verification

`tests/automation-gateway.test.mjs`:
* HMAC against Node `crypto` for short, block-size and long keys.
* Owner-only settings with exact replay.
* Reminder offsets, partial payments and demo isolation.
* Outbox lease, backoff and failure.
* Recurring catch-up through the real workflow.
* Simulated and signed-webhook payments, including duplicates and review cases.

`tests/automation-api.test.mjs`:
* Runs the cron, pay and webhook handlers against the database through a PostgREST-style named-argument adapter
  as `anon`.
