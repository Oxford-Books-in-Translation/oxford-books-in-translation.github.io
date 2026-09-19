# Oxford Books in Translation — Reading Map

An interactive world map of every book the group has read: where each author is
from, and what language the book was originally written in. It is a static site
with no backend and no build step — the page reads `data/books.csv` when it
loads, so adding a book means adding a row and pushing.

> **The book list is sample data.** `data/books.csv` currently holds 23
> well-known works in translation so the map has something to show. Replace
> them with what the group has actually read — delete the rows and add your
> own, or edit them in place. Nothing else needs to change.

## Adding a book

1. Add a row to [`data/books.csv`](data/books.csv).
2. Commit and push.
3. GitHub Pages redeploys and the map updates.

You can do all three from GitHub's web editor in a browser, from GitHub
Desktop, or from a text editor. If you edit the file in Excel, save it as
**CSV UTF-8** — otherwise accented characters and non-Latin titles get mangled.

### The columns

| Column | Required | Notes |
|---|---|---|
| `title` | yes | The title as we read it, usually the English one |
| `original_title` | no | The title in the original language |
| `author` | yes | |
| `author_nationality` | yes | ISO 3166-1 alpha-3 code, e.g. `HUN`. For more than one, separate with `\|`: `FRA\|DZA` |
| `original_language` | yes | Plain English name, e.g. `Hungarian` |
| `translator` | no | |
| `year_published` | no | Year of original publication |
| `date_discussed` | yes | `YYYY-MM-DD`, the date of the meeting |
| `notes` | no | Short free text, shown under the title in the book list |

Author nationality and original language are tracked separately and neither is
derived from the other — Beckett is Irish and wrote *Molloy* in French, and the
map and the language list should both be able to say so.

A field containing a comma must be wrapped in double quotes, which is ordinary
CSV and what any spreadsheet will do for you:

```csv
Palace Walk,بين القصرين,Naguib Mahfouz,EGY,Arabic,"William Maynard Hutchins, Olive E. Kenny",1956,2025-07-17,
```

Country codes are the three-letter ISO ones (`HUN`, `JPN`, `BRA`), not the
two-letter ones. `data/countries.json` is the full list of what's accepted.

## Checking the data before you push

```bash
node scripts/validate-books.mjs
```

It reports invalid country codes, missing required fields, malformed dates and
years, and languages spelled more than one way — `Portugese` next to
`Portuguese` would otherwise be silently counted as two languages. It exits
non-zero on errors, and the same check runs on every push and pull request via
[`.github/workflows/validate.yml`](.github/workflows/validate.yml).

The site applies exactly the same rules (both import `assets/js/validate.js`)
and shows anything it finds in a banner at the top of the page, so a typo is
visible even if nobody runs the script.

## Looking at it locally

The page fetches `data/books.csv`, and browsers block that over `file://`, so
opening `index.html` by double-clicking will show an error. Serve the folder
instead:

```bash
node scripts/serve.mjs
```

Then open <http://localhost:8080>. There is nothing to install and nothing to
build.

## Publishing to GitHub Pages

Once the repository is on GitHub: **Settings → Pages → Build and deployment →
Deploy from a branch**, branch `main`, folder `/ (root)`. The site appears at
`https://<user>.github.io/<repo>/` within a minute or two.

GitHub Pages on a free account requires the repository to be **public**. A
private repository needs a paid plan for Pages; if the group would rather not
publish the reading list, that is the decision to make first.

No Pages workflow is needed — the repository is already a static site, and
`.nojekyll` stops GitHub trying to process it as a Jekyll blog.

## How the map handles awkward cases

- **Several nationalities.** `FRA|DZA` counts the book for both countries, and
  it appears under either one. The headline "countries covered" counts each
  distinct country once.
- **Small countries.** The 110m boundary file has no polygon for about seventy
  small states and islands — Malta, Singapore, Martinique, Saint Lucia and
  others. A book from one of those gets a labelled dot at the country's centre
  instead of a shaded shape, so it is never invisible. Two neighbours in the
  Lesser Antilles will sit almost on top of each other; the book list is the
  reliable reading.
- **Former states.** `CSK`, `DDR`, `SUN` and `YUG` are accepted (they are ISO
  3166-3 codes) and appear as dots, with a warning suggesting the present-day
  country. Use `CZE` for Kundera unless "Czechoslovak" is the point you want to
  make.
- **Antarctica** is left off the map: it is a third of the height and nobody's
  nationality.
- **Countries with no books** are neutral grey, not zero-shaded, so the palest
  blue means *one book* rather than *none*.

## Layout

```
index.html                 the page
assets/css/styles.css      all styling, light and dark tokens
assets/js/app.js           page wiring: stats, filters, table, theme
assets/js/map.js           the choropleth
assets/js/data.js          loading and aggregation
assets/js/csv.js           CSV reader, shared with the validator
assets/js/validate.js      validation rules, shared with the validator
data/books.csv             the source of truth
data/countries.json        ISO codes, names, centroids
vendor/                    d3, topojson-client, world boundaries
scripts/validate-books.mjs the data check
scripts/serve.mjs          local preview server
```

D3 and the boundary data are committed to `vendor/` rather than loaded from a
CDN, so the site keeps working if a CDN changes or disappears, and works
offline.

## Still to decide

- Whether to record the country a book is **set in** as an optional column,
  separately from the author's nationality.
- Whether group members add books themselves via GitHub's web editor, or
  whether one person collects them.
- Public or private repository (see Pages, above).
- Whether to add cover images or links per book, or keep it lean.
