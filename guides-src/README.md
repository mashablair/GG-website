# PDF sources

Each free guide's PDF is printed from a page here. These aren't deployed (the
site serves `public/`); the guide pages on the site are sign-up forms only.

| Guide | Source | PDF |
|---|---|---|
| How to Prepare Your Exit | `exit-guide/guide.html` | `public/exit-guide/pdf/k7q3m-how-to-prepare-your-exit.pdf` |
| Stop Chasing, Start Choosing | `stop-chasing/guide.html` | `public/stop-chasing/pdf/r4v8n-stop-chasing-start-choosing.pdf` |
| How to Let Go of an Ex | `let-go/let-go.html` | `public/let-go/pdf/w9h2t-how-to-let-go-of-an-ex.pdf` |

To reprint after editing a source, run from the repo root (example: exit guide):

```
google-chrome --headless=new --no-pdf-header-footer --allow-file-access-from-files \
  --print-to-pdf=public/exit-guide/pdf/k7q3m-how-to-prepare-your-exit.pdf \
  "file://$PWD/guides-src/exit-guide/guide.html"
```

Then refresh the cover image the sign-up page shows (`public/<guide>/guide-cover.jpg`)
from page 1 of the new PDF (each guide starts with a designed cover page). Keep the PDF file names: nothing links to them, so the
only way to get one is the form, and `GUIDES` in `functions/api/guide.js` points at them.
