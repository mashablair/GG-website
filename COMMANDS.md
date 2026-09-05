# Commands

Everything you'll actually need, grouped by what you're trying to do. Run all of
these from the project folder:

```
cd ~/Desktop/GG-website
```

---

## Working on the site

Start the local server. Leave it running; edit a file, refresh the browser.

```
npx wrangler pages dev
```

Then open http://127.0.0.1:8788

To run the tests as well, send the output to a file they can read — with no
email provider configured locally, sign-in codes are printed rather than sent,
and the tests read them from there:

```
npx wrangler pages dev > /tmp/wrangler-dev.log 2>&1
```

Stop it with `Ctrl+C`.

---

## Running the tests

The dev server must be running (with output going to `/tmp/wrangler-dev.log`).
The purchase suite also needs the Stripe stand-in, in its own terminal:

```
python3 test/mock-stripe.py
```

Then:

```
bash test/purchase-flow.sh
bash test/login-flow.sh
bash test/gate-flow.sh
bash test/progress-flow.sh
```

They wipe the **local** database each time. Never production.

---

## Looking at your students

`--remote` means the real database. **Without it you're querying a local copy on
your Mac** — a completely different thing, and where the tests write.

Everyone who has signed up:

```
npx wrangler d1 execute dating-goddess-db --remote --command "SELECT id, email, first_name, created_at FROM students ORDER BY created_at DESC"
```

Students with what they bought:

```
npx wrangler d1 execute dating-goddess-db --remote --command "SELECT s.email, s.first_name, e.course_slug, e.status, e.amount_cents, e.purchased_at FROM students s JOIN enrollments e ON e.student_id = s.id ORDER BY e.purchased_at DESC"
```

How far someone has got:

```
npx wrangler d1 execute dating-goddess-db --remote --command "SELECT lesson_id FROM progress WHERE student_id = 1"
```

Count of everything:

```
npx wrangler d1 execute dating-goddess-db --remote --command "SELECT (SELECT COUNT(*) FROM students) AS students, (SELECT COUNT(*) FROM enrollments) AS enrollments, (SELECT COUNT(*) FROM progress) AS progress"
```

You can also browse it in the dashboard: **Workers & Pages → D1 →
dating-goddess-db → Console.**

> `DELETE` and `UPDATE` have no undo and no confirmation. Read before you write.

Give someone access by hand (if they paid another way, or something went wrong):

```
npx wrangler d1 execute dating-goddess-db --remote --command "INSERT INTO students (email, first_name) VALUES ('her@example.com','Anna') ON CONFLICT(email) DO NOTHING; INSERT INTO enrollments (student_id, course_slug, provider, external_id) SELECT id, 'dating', 'manual', 'manual-2026-08-28-anna' FROM students WHERE email='her@example.com'"
```

`external_id` just has to be unique — put something you'll recognise later.

---

## Looking at the course waitlist

People who asked to be told when the course opens. They are **not** students —
there's no account and nothing to sign into, so they never appear in the queries
above.

```
npx wrangler d1 execute dating-goddess-db --remote --command "SELECT id, first_name, email, source, created_at FROM waitlist ORDER BY created_at DESC"
```

How many, and when the last one arrived:

```
npx wrangler d1 execute dating-goddess-db --remote --command "SELECT COUNT(*) AS total, MAX(created_at) AS latest FROM waitlist"
```

Export it to a spreadsheet (`waitlist.csv` is gitignored — it holds real
people's email addresses, so don't commit it or email it around):

```
npx wrangler d1 execute dating-goddess-db --remote --json --command "SELECT first_name, email, created_at FROM waitlist ORDER BY created_at" | python3 -c "import sys,json,csv;rows=json.load(sys.stdin)[0]['results'];w=csv.DictWriter(open('waitlist.csv','w',newline=''),fieldnames=['first_name','email','created_at']);w.writeheader();w.writerows(rows);print(f'{len(rows)} rows -> waitlist.csv')"
```

`created_at` is **UTC**, not Florida time — subtract 4 hours in summer, 5 in
winter.

> **There is a second, older database called `gg-waitlist`.** It's from before
> the merge and holds one row from July. Nothing writes to it any more; the live
> form writes to `dating-goddess-db`. Don't go looking in it and conclude the
> form is broken.

---

## Secrets

List what's set (names only — values are never shown):

```
npx wrangler pages secret list --project-name gg-website
```

Set or replace one. The name stays exactly as written; you paste the **value**
at the prompt:

```
npx wrangler pages secret put STRIPE_SECRET_KEY --project-name gg-website
```

The ones that exist: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`SESSION_SECRET`, `CF_EMAIL_TOKEN`.

> **Secrets only reach new deployments.** After changing one, redeploy or the
> change silently does nothing. See below.

---

## Deploying

Every push to `main` deploys automatically. To force a rebuild without changing
anything — which is how you make a new secret take effect:

```
git commit --allow-empty -m "Rebuild" && git push
```

Check it actually worked. **A failed build leaves the old version serving, with
no visible sign anything is wrong:**

```
npx wrangler pages deployment list --project-name gg-website
```

Look at the Status column. `Failure` means the site is still running older code.

Quick check of what's configured on the live site:

```
curl -s https://mariablair.com/api/health
```

---

## Changing the database structure

`schema.sql` describes a **fresh** database. Every statement uses
`IF NOT EXISTS`, so running it against a database that already has those tables
does nothing at all — which is exactly why it can't be used to change an
existing one.

For a new table or a new database, edit `schema.sql` and apply it to both:

```
npx wrangler d1 execute dating-goddess-db --remote --file=schema.sql
npx wrangler d1 execute dating-goddess-db --local  --file=schema.sql
```

To change a table that already exists, write a numbered file in `migrations/`
and run that instead — and update `schema.sql` to match, so a fresh database
comes out the same shape:

```
npx wrangler d1 execute dating-goddess-db --local  --file=migrations/0001-enrollments-per-product.sql
npx wrangler d1 execute dating-goddess-db --remote --file=migrations/0001-enrollments-per-product.sql
```

Always run it locally first and check the result before touching `--remote`.
To see the shape of a table as it stands:

```
npx wrangler d1 execute dating-goddess-db --remote --command "SELECT sql FROM sqlite_master WHERE name='enrollments'"
```

### Migrations so far

| File | What it did |
| --- | --- |
| `0001-enrollments-per-product.sql` | Widened the uniqueness on `enrollments` from `(provider, external_id)` to `(provider, external_id, course_slug)`, so one checkout containing two products records both instead of silently dropping the second. **Must be applied to the remote database before selling a bundle or a cross-sell.** |

---

## Stripe

Test cards — any future expiry, any CVC, any postcode:

| Card | Does |
|---|---|
| `4242 4242 4242 4242` | Succeeds |
| `4000 0000 0000 9995` | Declined, insufficient funds |
| `4000 0025 0000 3155` | Asks for 3D Secure |

Useful dashboard links (`/test/` in the URL forces test mode):

- Payment links — https://dashboard.stripe.com/test/payment-links
- Webhooks — https://dashboard.stripe.com/test/workbench/webhooks
- API keys — https://dashboard.stripe.com/test/apikeys

On the webhook's page there's a **Send test events** button, for re-triggering
a `checkout.session.completed` without paying again.

---

## Lava.top

There is no test mode. Every payment is real money, so the only true end-to-end
test is a cheap product you create, buy, refund, and delete.

**You cannot buy your own product.** It's blocked twice over, and the two look
nothing alike:

- With the email on your Lava seller account, the invoice never gets made —
  their API answers `400 Incorrect email to purchase`. The payment page names
  the address as the problem.
- With any other email, but signed into `app.lava.top` in that browser, the
  invoice is created and the checkout loads — then the widget refuses with
  «Вы не можете купить свой продукт». It checks the logged-in session, not the
  email.

So to walk the flow yourself: a plus-alias (`you+ru@gmail.com`) **and** an
incognito window. For a real payment, easiest is asking someone else to buy it.

Listing your products and their offer ids — the offer is the price, and it isn't
shown anywhere in the dashboard:

```
curl -s "https://gate.lava.top/api/v2/products?feedVisibility=ALL" \
  -H "X-Api-Key: YOUR_LAVA_API_KEY"
```

Their published docs and their npm SDK have both been wrong about things that
matter. Check responses against the real API before trusting a shape.

---

## Git

```
git status
git add -A && git commit -m "What changed and why"
git push
```

Undo changes to a file you haven't committed:

```
git checkout -- path/to/file
```

See what changed in the last commit:

```
git show --stat
```

---

## When something's wrong

1. **`curl -s https://mariablair.com/api/health`** — is the
   configuration all there?
2. **`npx wrangler pages deployment list --project-name gg-website`**
   — did the last build actually succeed?
3. **Stripe → Webhooks → the endpoint → Event deliveries** — did Stripe try, and
   what did we answer?
4. **The database** — did the row get written?

Most problems so far have been one of: a failed build still serving old code, or
a secret set but not redeployed.
