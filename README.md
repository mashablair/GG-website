# mariablair.com — Glorious Goddess 🐆

Pure HTML + CSS + vanilla JS. No frameworks, no build step. Hosted on Cloudflare Pages with a D1 database for waitlist signups.

## Files

| File                        | What it is                                               |
| --------------------------- | -------------------------------------------------------- |
| `index.html`                | Homepage — the scrolling story                           |
| `my-story.html`             | Full story page                                          |
| `course.html`               | Intentional Dating Method (waitlist page)                |
| `consultations.html`        | 1:1 consultations ($97/session)                          |
| `contact.html`              | Instagram + YouTube links                                |
| `privacy.html`              | Privacy policy                                           |
| `terms.html`                | Terms of service                                         |
| `css/style.css`             | All styling (brand colors + fonts at the top in `:root`) |
| `js/main.js`                | Mobile menu + waitlist form submission                   |
| `functions/api/waitlist.js` | Cloudflare Pages Function that saves signups to D1       |
| `schema.sql`                | Database table definition (run once)                     |

## Deploy to Cloudflare Pages (one-time setup)

1. **Push this folder to a GitHub repo** (or use direct upload / `wrangler pages deploy .`).
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → connect the repo.**
   No build command, output directory = `/` (root).
3. **Create the D1 database:**
   ```
   npx wrangler d1 create gg-waitlist
   npx wrangler d1 execute gg-waitlist --remote --file=schema.sql
   ```
4. **Bind it to the Pages project:** Pages project → Settings → Bindings → Add → D1 database.
   - Variable name: `DB` (must be exactly this)
   - Database: `gg-waitlist`
5. **Custom domain:** Pages project → Custom domains → add `mariablair.com` (already on Cloudflare, so it's one click).

### Viewing your waitlist signups

```
npx wrangler d1 execute gg-waitlist --remote --command "SELECT first_name, email, created_at FROM waitlist ORDER BY created_at DESC"
```

Or in the Cloudflare dashboard: **Storage & Databases → D1 → gg-waitlist → waitlist table.**

### Exporting the list to a CSV

When you're ready to email everyone, this writes `waitlist.csv` to the current folder — open it in Numbers or Excel, or import it straight into your email tool:

```
npx wrangler d1 execute gg-waitlist --remote --json \
  --command "SELECT first_name, email, created_at FROM waitlist ORDER BY created_at DESC" \
  | python3 -c "import sys,json,csv; rows=json.load(sys.stdin)[0]['results']; w=csv.DictWriter(sys.stdout,['first_name','email','created_at']); w.writeheader(); w.writerows(rows)" \
  > waitlist.csv
```

Note that D1 only *stores* the signups — it can't send email. When you launch, export the CSV and load it into whatever you send from.

## Things to swap in when ready

- **Stripe link** — find & replace `REPLACE_WITH_CONSULT_LINK` across all the HTML files (it appears 18 times, mostly in the nav on every page) and paste your Stripe payment link (create one at dashboard.stripe.com → Payment Links).
- **Consultation price** — currently **$97**, shown as marked down from $147. To change it, edit the `price-display__now` and `price-display__was` lines in [consultations.html](consultations.html), plus the `Book Your Consultation — $97` button text and the page's meta description.
- **Course enrollment** — [course.html](course.html) is in waitlist mode: it shows the $397 price as a preview, but the CTA collects emails instead of selling. When you're ready to open doors, swap the form in the `#waitlist` section back to a Stripe payment link button.
- **YouTube URL** — all pages link to `youtube.com/@GloriousGoddess`. If your channel handle is different, find & replace it across the HTML files.
- **Photos** — see below.

## Photos

All the placeholders have been replaced with real photos in `images/`. When swapping one out, keep the `width` and `height` attributes on the `<img>` accurate to the new file so the page doesn't jump around while loading. Compress before adding (e.g. squoosh.app), target under ~200 KB each.

## Local preview

Any static server works:

```
npx serve .
```

(The waitlist form only saves for real once deployed to Cloudflare with the D1 binding — locally it will show the friendly error message.)

To test the form + database locally:

```
npx wrangler pages dev . --d1 DB=gg-waitlist
```

The local database starts out empty with no tables, so the first signup will fail until you create the table in it. Run the dev server once, submit the form (it will error), then apply the schema to the local copy and try again:

```
sqlite3 "$(find .wrangler/state/v3/d1 -name '*.sqlite' ! -name 'metadata*')" < schema.sql
```

`.wrangler/` is just local test state — delete it whenever, and don't commit it.
