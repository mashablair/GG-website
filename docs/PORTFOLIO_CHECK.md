# Portfolio verification — November 18, 2026

- Live public homepage: HTTP 200, rendered without browser exceptions. Screenshot shows public marketing content only.
- Disposable local D1 database and console-only email; payment providers replaced by local stand-ins.
- Purchase flow: 33 passed. Login: 34 passed. Course gates: 42 passed. Progress/account flow: 31 passed. Lava flow: 50 passed. Video signing: 15 passed.
- Updated two purchase-test assertions to read the current support email from the catalog instead of matching a retired Instagram handle.
- Local fixture settings must match the mocks: `STRIPE_WEBHOOK_SECRET=whsec_local_test_secret`, `STRIPE_API_BASE=http://127.0.0.1:8799/v1`, `LAVA_WEBHOOK_SECRET=lava_test_webhook_secret`, `LAVA_API_KEY=lava_test_api_key`, `LAVA_API_BASE=http://127.0.0.1:8797`, `LAVA_OFFER_ID=offer-rub-one-time`, and `LAVA_CHECKOUT_OPEN=true`. These are test-only values, not production credentials. Restart the local server after changing `.dev.vars`.
- No real purchases, subscriber changes, or live student writes were performed. Live provider configuration, email delivery, and paid video playback remain outside this check.

These results describe the checked revision and environment, not a guarantee about future deployments.
