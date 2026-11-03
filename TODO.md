# To do

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
