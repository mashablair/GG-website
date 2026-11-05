# PDF sources

The free guides are printed from these pages (not deployed; the site serves `public/`).

To rebuild the let-go PDF after editing `let-go/let-go.html`:

```
cd guides-src/let-go
google-chrome --headless=new --no-pdf-header-footer --allow-file-access-from-files --print-to-pdf=../../public/let-go/pdf/w9h2t-how-to-let-go-of-an-ex.pdf "file://$PWD/let-go.html"
```
