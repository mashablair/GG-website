# Tests

Four suites, 99 checks. All run against the local dev server and wipe the
**local** database each time — never production.

```
npx wrangler pages dev > /tmp/wrangler-dev.log 2>&1     # in one terminal
python3 test/mock-stripe.py                              # in another, for the purchase suite

bash test/purchase-flow.sh
bash test/login-flow.sh
bash test/gate-flow.sh
bash test/progress-flow.sh
```

The dev server's output has to go to a file the tests can read, because with no
email provider configured the sign-in codes are printed rather than sent.
`test/lib.sh` waits for a *new* code to appear rather than sleeping and taking
the last one — sleeping races wrangler's buffered output and silently returns
the previous code, which then fails to verify and looks like an application bug.

## Progress and the account page

```
bash test/progress-flow.sh
```

- the dashboard starts at 0 of 35 and counts up as lessons are completed
- a completed lesson writes one row, and shows a checkmark in the sidebar
- progress follows her to a second sign-in from a clean browser
- completing lessons out of order counts correctly, per module and overall
- unmarking removes the row; marking twice doesn't duplicate it
- an unknown lesson id is refused, and writes nothing
- a signed-out visitor can't write progress at all
- the account page shows her email, her purchases and what she paid
- her name can be changed and persists

## The sign-in flow

With no email provider configured the code is printed to the console instead of
being sent, so the test reads it back from the dev server's log. Start wrangler
with its output going somewhere the test can find:

```
npx wrangler pages dev > /tmp/wrangler-dev.log 2>&1
```

```
bash test/login-flow.sh
```

Point `DEV_LOG` at a different path if you'd rather log elsewhere.

### What it covers

- the form asks for an email and explains there's no password
- an unknown address and a real one produce **identical** pages, and no code is
  stored for the unknown one — nobody can probe who bought the course
- the database holds a hash, never the code itself
- a wrong code is refused, with a message
- the right code signs her in, with an HttpOnly cookie
- a code works exactly once
- five wrong guesses burn the code, so the correct one stops working too
- a sixth request within an hour issues nothing
- `?next=` can't redirect off-site
- signing out clears the cookie

## Signed video URLs

```
node test/stream-signing.mjs
```

No server or database needed. It generates a throwaway RSA keypair, signs a
token with the same code the site uses, and verifies it with the public half —
so if this passes, Stream will accept the tokens too.

- with no key configured, no token is issued and lessons fall back to plain
  video ids, so nothing breaks before the key exists
- the token is a three-part RS256 JWT naming the key and the video
- it expires inside Stream's 24-hour limit
- **the signature verifies against the public key**
- swapping the video id breaks the signature
- the bare video id never appears in the player URL, and the poster is signed
  too — it would 403 otherwise

## Lava.top

```
bash test/lava-flow.sh
```

Starts its own stand-in for Lava's API, so it needs no account and no keys.

- a request with no credentials, a wrong key, or wrong Basic auth is refused
- both credential schemes work, since either may be configured on their end
- a genuine purchase creates one student and one enrollment, in roubles
- three more deliveries of the same webhook change nothing
- **an unsettled contract, an invented contract, and a real contract with a
  different buyer named in the webhook all grant nothing** — this is what stops
  a leaked webhook secret becoming free access
- a product that isn't a course unlocks nothing
- failed payments are acknowledged rather than retried forever
- a refund revokes access by buyer, since refund events don't name the contract
- Stripe and Lava can hold the same external id without colliding

## The gate

```
bash test/gate-flow.sh
```

Needs the same `DEV_LOG` as the sign-in tests, since it signs in for real.

- every page under `/course` redirects a signed-out visitor to `/login`
- the redirect remembers where she was going
- the sales page, sign-in, welcome and health stay open
- a signed-in student with a paid enrollment gets in
- a tampered session cookie is refused
- a refunded student is blocked, and told why rather than shown a bare error
- signing out closes it again

## The purchase flow

Checks the whole path from "Stripe says she paid" to "she's logged in and
watching", without live keys and without touching Stripe.

Three terminal windows:

```
python3 test/mock-stripe.py
```

```
npx wrangler pages dev
```

```
bash test/purchase-flow.sh
```

The first one is a stand-in for the two Stripe API calls the flow makes.
`.dev.vars` points the code at it via `STRIPE_API_BASE`, which is only ever set
locally.

**It wipes the local database on each run.** That's the local one only — the
`--local` flag — never production.

### What it covers

Signature handling
- a correctly signed webhook is accepted
- a forged signature is rejected
- a missing signature is rejected
- an old timestamp is rejected, so a captured webhook can't be replayed

Account creation
- a paid checkout creates exactly one student and one enrollment
- the email is lowercased and trimmed
- the first name is picked out of the full name

Idempotency
- delivering the same webhook four times still leaves one enrollment

Refusals
- an unpaid session grants nothing
- an unknown session id is refused

Auto-login
- `/welcome` redirects into the course and sets an HttpOnly session cookie
- the same welcome link refuses to work a second time, and sets no cookie

Refunds
- a refund marks the enrollment refunded, which removes access
