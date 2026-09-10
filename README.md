# CP Weekly Menu — refactored

Built from `index.html` @ `111da34` (2,246 lines, 8,843,167 bytes,
sha1 `273bd16b…`). Same app, same behavior. Two structural changes:

1. **Sprites are files, not base64.** Four PNGs were pasted into the page as
   data URIs — three in CSS, one as the blackjack dealer `<img>`. They are now
   `src/assets/*.webp`. 8.2 MB → 853 KB, and the browser caches them across
   page loads instead of re-downloading them inside the HTML.
2. **Vite build + ES modules.** One 2,246-line file becomes `index.html` plus
   seven JS modules, five CSS files, and four images.

**Total transfer: 8.84 MB → 1.01 MB.**

## Running it

```bash
npm install
npm run dev      # localhost:5173, hot reload
npm run build    # -> dist/
npm run preview  # serve dist/ locally
npm run lint     # eslint, configured to catch undefined identifiers
```

Deploy `dist/`, not the repo root. **The repo root is no longer servable as
static files** — `index.html` references `/src/main.js`, which imports CSS, and
browsers can't do that. It only works after `npm run build`.

## Layout

```
index.html          markup only
src/
  main.js           entry: CSS imports, showView, window handler exports
  firebase.js       config + initializeApp, exports `db`
  meals.js          menu, ratings, comments, QR, admin dashboard
  arcade.js         flap/stack games, leaderboards, spins, pi wallet, results
  blackjack.js      blackjack table
  skins.js          skin catalog + wheel helpers
  styles/           base, skins, arcade, stack, blackjack
  assets/           bird-base, bird-sheet, bird-fire, bj-dealer (.webp)
```

Dependency graph, one-directional, no cycles:

```
main.js → blackjack.js → arcade.js → meals.js  → firebase.js
                      ↘ skins.js  ↗
```

## Five things that changed in the code

Everything else is a byte-identical move. These five could not be:

1. **`showView` moved to `main.js`.** It is the only function that touches both
   halves of the app, so it belongs to neither module.
2. **`meals.js` emits events instead of calling the arcade.** It used to call
   `renderGameLeaderboard()` and `loadArcadeStats()` directly. Now it calls
   `emit('cloudUpdate')` / `emit('gameStats')` and `main.js` wires the arcade to
   them. This is what keeps the graph acyclic.
3. **`arcade.js` reads `isAdminLoggedIn()` instead of `adminLoggedIn`** (3 sites).
   A `let` in another module cannot be read across an ES module boundary that way.
4. **`chapterUseCatalog` calls `setArcadeSkins()`.** It used to assign
   `ARCADE_SKINS` and `ARCADE_TOTAL_WEIGHT` directly; those live in `skins.js`,
   and ES modules make imported bindings read-only, so the assignment would
   throw at runtime.
5. **`blackjack.js` calls `setChapterPiBalance()`** (2 sites) for the same
   reason — `chapterPiBalance` is owned by `arcade.js`. Its *reads* of
   `chapterPiBalance`, `arcadeRound`, `arcadeBusy` and `arcadePlayer` are
   unchanged; imported bindings are live, so reads see updates.

## Inline `onclick` attributes

The markup still uses `onclick="switchDay(0)"`. Module scope is not global, so
every function named in an `on*` attribute is republished on `window` at the
bottom of `main.js`. All 25 are accounted for.

**If you add a new `onclick="doThing()"`, you must add `doThing` to that block**
or it throws at runtime. `npm run lint` will not catch this.

## What was verified

- `npm run build` succeeds; 14 modules transformed.
- `eslint` with `no-undef`: zero problems, so nothing is left dangling across a
  module boundary.
- Headless Chrome loads `dist/` with **no console errors and no page errors**;
  all 25 handlers resolve as functions; `showView` navigates all five views; the
  bird sprite CSS and the dealer `<img>` both resolve to the built `.webp`.
- Markup is structurally identical: 114 element ids and 174 class attributes,
  matching the original exactly, with no tag-count differences.
- WebP at q90, visually indistinguishable from the source PNGs at 1:1.

**Not verified:** anything requiring a live Firebase session. The smoke test
blocks the database on purpose so a test run cannot write to production. Sign-in,
posting a rating, playing a round, spinning the wheel, and a blackjack hand all
need a human click.

## Known follow-ups (not done here)

- `arcade.js` is ~65 KB and could not be split further: `arcadeCall` assigns
  `arcadeOffset`, which is declared 100 lines below it, and ES modules forbid
  assigning across a module boundary. Untangling that shared state comes first.
- Firebase is still the v8 compat SDK from a CDN. `npm i firebase` and
  `import firebase from 'firebase/compat/app'` is API-identical and pins the
  version in `package.json`.
- Add a `favicon.ico` (or a `<link rel="icon">`); the browser 404s on it.
- The security problems are untouched. This refactor is structural only, and it
  has not been reviewed against the ~370 lines of blackjack and score-removal
  code that are new since the version I reviewed.
