# mariablair.com — Glorious Goddess 🐆

Pure HTML + CSS + vanilla JS. No frameworks, no build step. Hosted on Cloudflare Pages with a D1 database for waitlist signups.

## Files

| File                        | What it is                                               |
| --------------------------- | -------------------------------------------------------- |
| `index.html`                | Homepage — the scrolling story                           |
| `my-story.html`             | Full story page                                          |
| `course.html`               | Intentional Dating Method (waitlist page)                |
| `work-with-me.html`         | 1:1 consultations ($47/session)                          |
| `contact.html`              | Instagram + YouTube links                                |
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

## Things to swap in when ready

- **Stripe link** — in [work-with-me.html](work-with-me.html), search for `REPLACE_WITH_YOUR_LINK` and paste your Stripe payment link (create one at dashboard.stripe.com → Payment Links).
- **Consultation price** — currently **$47**. To change it, edit the `price-card__price` line in [work-with-me.html](work-with-me.html). ($47 is a very accessible intro price for 60 minutes — easy to raise once testimonials come in.)
- **YouTube URL** — all pages link to `youtube.com/@GloriousGoddess`. If your channel handle is different, find & replace it across the HTML files.
- **Photos** — see below.

## Photo shot list (to replace the placeholders)

Each placeholder is a `<div class="photo-placeholder" data-photo="...">`. Replace it with `<img src="images/your-photo.webp" alt="...">` (keep the same spot in the HTML). Aim for warm, golden-hour shots. Compress to WebP before adding (e.g. squoosh.app), target under ~200 KB each.

| Page                      | Shot needed                                   | Orientation     |
| ------------------------- | --------------------------------------------- | --------------- |
| Home hero                 | Close crop, eye contact, confident & warm     | Portrait (4:5)  |
| Home "Follow the journey" | 4 Reel thumbnails (screenshot your top Reels) | Vertical (9:16) |
| My Story top              | Candid, warm light, present day               | Landscape (3:2) |
| Course "Who teaches this" | Warm bio portrait                             | Square (1:1)    |

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
