# Oxford Books in Translation — Reading Map

An interactive world map of every book the group has read: where each author is
from, and what language the book was originally written in. It is a static site
with no backend and no build step — the page reads `data/books.csv` when it
loads, so adding a book means adding a row and pushing.

`data/books.csv` holds the group's real reading list, starting from the January
2026 book night. Older sessions can be added the same way, in any order — the
site sorts by `date_discussed`.

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

Translators are counted, listed and clickable, so write them as they should
appear: forename first, and separated by a comma or "and" when a book has more
than one (`"William Hutchins and Olive Kenny"`). Writing a name surname-first
would split it into two people.

Author nationality and original language are tracked separately and neither is
derived from the other — Beckett is Irish and wrote *Molloy* in French, and the
map and the language list should both be able to say so.

A field containing a comma must be wrapped in double quotes, which is ordinary
CSV and what any spreadsheet will do for you:

```csv
The Meursault Investigation,"Meursault, contre-enquête",Kamel Daoud,DZA,French,John Cullen,2013,2026-04-17,
```

Country codes are the three-letter ISO ones (`HUN`, `JPN`, `BRA`), not the
two-letter ones. `data/countries.json` is the full list of what's accepted.

## Checking things before you push

```bash
npm run check
```

That runs both checks below. They need no dependencies — just Node.

### The data

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

### The colours

```bash
node scripts/check-contrast.mjs
```

It reads the colour tokens straight out of `styles.css`, so it cannot drift
from what the site renders. It checks WCAG AA text contrast, the 3:1 minimum
for the edge of every interactive control, and the separation between every
pair of map shades under protanopia, deuteranopia and tritanopia. **If you
change a colour, run this.** It fails the build rather than letting the map
quietly become unreadable.

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

### Sharing the link

The page already carries Open Graph tags, so pasting the link into a chat or
onto Meetup shows a proper title and description rather than a bare URL.

Two tags are missing on purpose, because a preview card needs **absolute**
URLs and there was no address yet. Once the site is live, add them to
`<head>` in `index.html`:

```html
<meta property="og:url" content="https://USER.github.io/REPO/">
<meta property="og:image" content="https://USER.github.io/REPO/share.png">
```

`share.png` should be 1200×630. A screenshot of the map on its cream
background does the job. Add `<meta name="twitter:card" content="summary_large_image">`
in place of the existing `summary` at the same time, so the image gets the
full-width card.

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
vendor/fonts/              Fraunces and Newsreader (woff2, latin)
scripts/validate-books.mjs the data check
scripts/serve.mjs          local preview server
```

D3, the boundary data and the two typefaces are committed to `vendor/` rather
than loaded from a CDN, so the site keeps working if a CDN changes or
disappears, works offline, and sends nothing to a third party when someone
opens it.

## A note on the design

Laid out as a printed page rather than a dashboard. Warm paper rather than
screen-white, type doing the work, no imagery, and no cards, boxes or shadows —
loosely in the spirit of publishers who put the words first. **Fraunces** sets
the display type and **Newsreader** the reading type (both open licence, both
committed to the repo).

The page opens with a masthead and a colophon of three figures under a rule.
Each section is introduced by a numeral and a rule, running text is held to a
comfortable measure (about 38rem) while the map and the book list run the full
width, and quiet labels wear letterspaced caps. The asymmetry between the
narrow text column and the wide figures is the main compositional device.

**Colour does two jobs and uses two hues for them.** Green is the data — the
map shading and the language bars. Terracotta is the interface — links, focus
rings, selection. Keeping them apart means a colour tells you which kind of
thing you are looking at, and stops the page reading as one flat wash.

The map ramp is a single-hue green generated in OKLCH and checked against the
actual paper colours: lightness increases step by step, and the palest shade
still clears a 2:1 contrast ratio against the page, so *one book* is legible
rather than nearly invisible.

**Every language bar is the same colour on purpose.** Language is a nominal
category with no natural order, so giving each one its own hue would spend the
colour channel re-encoding what the bar length already shows — and would run
out of distinguishable colours once the list passes eight. Bar length carries
the count; colour says "this is data".

Titles in Korean, Japanese or Cyrillic fall back per glyph to a system face,
since the vendored fonts carry only the latin range.

## Accessibility

The site targets **WCAG 2.1 AA**, and the parts that can be checked mechanically
are checked by `scripts/check-contrast.mjs` on every push.

- **Contrast.** All body text clears 4.5:1 and all display text 3:1, in both
  themes. The edge of every interactive control clears 3:1.
- **Colour vision.** The map uses one hue and varies lightness, so magnitude
  survives colour blindness: every pair of shades stays at least 6 apart in
  OKLab under protanopia, deuteranopia and tritanopia (the worst pair measures
  8.9). Read countries also carry a fine outline, so "we've read this" never
  depends on seeing the fill colour at all.
- **Not colour alone.** The legend labels every step in words and numbers, an
  invalid country code is underlined and carries hidden text naming the
  problem, and every value on the map is also in the book table.
- **Keyboard.** Everything is reachable and the focus ring is high contrast.
  Only the countries that have books are in the tab order — putting all 175 in
  it would bury the rest of the page. The country index beneath the map is the
  easy way to reach a country without hunting for its shape, which matters most
  for the small ones drawn as dots.
- **Screen readers.** Each country has a spoken label with its count, original
  titles are tagged with their own language so pronunciation switches, and
  right-to-left titles are marked as such.
- **Reflow and zoom.** No horizontal scrolling at 320px, and the WCAG
  text-spacing overrides clip nothing.
- **Reduced motion, high contrast and Windows forced-colors** are all
  respected; in forced-colors the map keeps its ramp rather than flattening to
  a single colour.

### Links

Following [NN/g's link guidelines](https://www.nngroup.com/articles/guidelines-for-visualizing-links/),
two things are reserved and should stay that way:

- **The link colour (`--accent`) is only ever worn by something clickable.**
  Not a heading, not a numeral, not a label, not a status. If you need to
  emphasise text, use `--ink` or weight, not the link colour.
- **Underlining is only ever used on links.** Underlined text that does nothing
  is a broken promise.

Links are terracotta, and NN/g is explicit that red and green link colours
*must* be underlined, because colour blindness can flatten them into the
surrounding text. Ours measure 2.15:1 against body text in light mode — well
under the 3:1 that colour alone would need — so **the underline is doing the
real work and must not be removed**.

The invalid-country-code marker deliberately uses neither: red would sit about
8 ΔE from the link colour and could be mistaken for one, so it says
"(invalid code)" in words instead.

Outbound links (currently just the Meetup group, in the masthead and the
footer) carry a small ↗ and get a **visited** colour — the same hue, duller and
less luminous, so a followed link reads as used without looking unrelated.
`scripts/check-contrast.mjs` checks the visited colour for readability and for
being distinguishable from both the unvisited link and body text. Links open in
the same tab.

## Still to decide

- Whether to record the country a book is **set in** as an optional column,
  separately from the author's nationality.
- Whether group members add books themselves via GitHub's web editor, or
  whether one person collects them.
- Public or private repository (see Pages, above).
- Whether to add cover images or links per book, or keep it lean.
