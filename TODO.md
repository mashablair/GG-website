# To do

## Switch Stripe from test to live — due by December 15, 2026

The site still runs on Stripe's **test** keys (`/api/health` says
`stripeMode: "test"`). Real money is taken fine by the live Payment Links, but
the site never hears about it, so **a real buyer gets no account and no course
access**. Held off on purpose on November 3, 2026: the course is still behind
the waitlist. Do this before anything that should create an account goes on
sale.

**To do it:**

1. **Map the live prices.** In `functions/_lib/catalog.js` → `byStripePrice`, add
   the live price ids next to the test ones (they sit side by side, nothing is
   swapped): the Dating Method course ($247) → `'dating'`, and the Private
   Consultation ($97) → `'consult-60'`. Price ids are on each product's page in
   the live Stripe dashboard (`price_…`).
2. **Create a live webhook** in Stripe (live mode → Workbench → Webhooks → Add
   destination): URL `https://dating-goddess.com/api/webhooks/stripe`, with the
   same 5 events as the test one — `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `charge.refunded`.
3. **Swap the secrets in Cloudflare** (Maria pastes these — they're secret):
   ```
   npx wrangler pages secret put STRIPE_SECRET_KEY --project-name gg-website      # the live sk_live_… key
   npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name gg-website  # the new live webhook's whsec_…
   ```
   Keep the test keys in the local `.dev.vars`, so the tests still run.
4. **Point the live Payment Links at the site.** For each one that should create
   an account, set "After payment → Don't show confirmation page → redirect to"
   `https://dating-goddess.com/welcome?session_id={CHECKOUT_SESSION_ID}`.
   - The Dating Method Course currently redirects to the retired
     `dating-goddess-course.pages.dev/welcome` — must change.
   - Private Consultation currently shows Stripe's own message — change it if
     consultations should appear on the buyer's dashboard.
5. **Redeploy** (any push to `main`) so the new secrets are picked up.
6. **Check:** `curl -s https://dating-goddess.com/api/health` shows
   `stripeMode: "live"`; make one real purchase of the cheapest product, confirm
   the account and dashboard appear and the webhook delivery succeeded in
   Stripe, then refund it and confirm access is removed.

## Bring Lava.top payments back — due by December 15, 2026

Lava (rouble card / СБП checkout for buyers in Russia and the CIS) was switched
off on November 3, 2026 when the site moved to dating-goddess.com. Nothing was
deleted: the checkout page, the webhook receiver, `/pay/complete` and the
catalog entry are all still in the code, just switched off.

**Why it's off:** in the Lava dashboard, the webhook still points at
`https://dating-goddess-course.pages.dev/api/webhooks/lava` — the old sales-page
project, which hasn't had any server code since September. It answers 405, so
Lava's payment, refund and chargeback notifications have been going nowhere.

**To fix it:**

1. In Lava (app.lava.top → Интеграции → API → expand the API key → ⋮ →
   Редактировать), change the webhook URL to
   `https://dating-goddess.com/api/webhooks/lava`, and enter the webhook key in
   the «API key» field — the same value as `LAVA_WEBHOOK_SECRET` in Cloudflare.
   If nobody has it any more, make a new one and set it in both places:
   `npx wrangler pages secret put LAVA_WEBHOOK_SECRET --project-name gg-website`
2. Turn the checkout back on: set `checkoutOpen: true` under `lava` in
   `functions/_lib/catalog.js`, and push.
3. Unhide the button on the sales page: in the `dating-goddess-course` repo,
   `public/index.html`, remove the `HIDDEN Nov 3, 2026` comment wrapper around
   «Оплатить картой РФ или через СБП».
4. Check: `curl -s https://dating-goddess.com/api/health` shows
   `lavaCheckoutOpen: true` and `lavaWebhooksReady: true`; then make a real
   cheap test purchase (Lava has no test mode — see COMMANDS.md → Lava.top), and
   confirm the delivery shows as successful in Lava's «История Webhooks».
