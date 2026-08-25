# Yozakura 夜桜

*Night blossom.* A companion piece for [nextlvl.win](https://nextlvl.win) — an
interactive QR code that grows on a tree. Tap it and the leaves spiral down to
land on the exact grid cells they encode — the code assembles itself out of the
canopy, then the camera tilts to straight-down and the blocks flatten into a
crisp, scannable symbol.

Built from scratch: no libraries, no framework, no build toolchain beyond one
Python script. `dist/yozakura.html` is a single self-contained file you can host
anywhere — its only network request is the Google Fonts stylesheet, and there is
a real fallback stack behind it if you'd rather delete that line.

## Making it yours

Everything that names the site sits in one block at the top of
`src/js/app.js`:

```js
const BRAND = {
  name: 'Yozakura',
  title: 'Yozakura',
  home: 'https://nextlvl.win',
  prompts: { grown: 'Tap the tree to raise the code', … },
  downloadName: 'yozakura-qr.png'
};
```

Change those and the wordmark, the browser tab, the home link, every prompt and
the saved filename follow — nothing else hard-codes a name. The mark itself is
the inline `<svg>` in the `.brand` link in `src/index.html`. Palettes live in
`SKIES`, `CHROME` and `ACCENTS` directly below.

### Inherited from nextlvl.win

The design is not its own island — it takes the site's tokens directly:

| | Source |
| --- | --- |
| Skies | the site's `--sky-1 … --sky-4` ramp, `#120a2a → #2a1550 → #5b2a63 → #a34d70` |
| Accents | `--pink` `#ff8fb1`, its hover rose `#ff5c8a`, `--violet`, `--cyan`, `--gold` |
| Chrome | `--bg-alt` glass, `--border` hairlines, `--text` / `--text-dim` |
| Wordmark | the site's `--grad`, clipped to the text, exactly as its `h1` does |
| Type | Outfit for display, Inter for text, JetBrains Mono for the label caps |
| Radius | the site's 20px on the large surfaces |

Because every sky is a night sky, there is a single `CHROME` set rather than a
light/dark pair.

## The garden

Three scenes, each owning its sky, its ground, its foliage and whatever is
falling through it:

| | Sky | Falling |
| --- | --- | --- |
| Day | `#4aa8e0` → `#cfe9f4` | sun motes drifting |
| Night | `#0c0819` → `#241243` | fireflies, stars, blossom lit from within |
| Rainy | `#47555f` → `#98a9b4` | rain streaks, ripples, and a wet mark where each blossom lands |

Rain falls hard and nearly straight, drawn as streaks rather than drops — a
falling drop reads as a line at any shutter a screen can manage. In Rainy, a
blossom that comes down leaves the mark of it on the stone for a moment after
it has gone.

Six accents pull the scene's foliage about a third of the way toward your pick.
The accent owns the bloom, the wildflowers and the UI outright.

### Where the code is square, and where it isn't

The garden sits **isometric** — the plot renders as a diamond. The reveal then
rotates the plaza square-on and lifts the eye to straight down together, so the
code lands as a **centred, axis-aligned square** with no perspective left for a
scanner to undo.

That split is deliberate, and it cost three attempts to learn. Viewing the plot
head-on so its *floor* reads as a screen-square puts the camera at yaw 0, and
there a tree centred on its own floor either drapes its canopy straight across
the plot (low pitch) or collapses the floor to a thin band (high pitch). Every
head-on variant looked worse than the isometric one: canopy chopped at the
frame edge, then a crown split into two lobes above a stub of trunk. The view
that has to be square is the code's, not the garden's.

Yaw runs 45° → 0° and never crosses zero, so the painter ordering the ground
pass relies on stays valid the whole way through.

### Grass on the code

The code's dark modules settle into planted green and grow the same tapered,
curved blade the verge is planted with. Height and sway are both held down
deliberately: grass overhanging its module would soften the very edges a
scanner keys on, so it reads as turf without leaving the square it grows in.

Each scene carries its own module colour rather than reusing the decorative
grass palette — that palette is pale by design in some scenes and would have
left nothing to read.

### Limbs

Branches aren't strokes. Each is drawn three times across its own width — a
shadowed base, the bark itself, and a narrow highlight offset toward the light —
which is all it takes to read as a round branch. They taper toward the tip, and
the trunk carries bark plates where there's width enough to see them.

Done as three passes over every limb rather than three fills per limb: a
`fillStyle` assignment reparses the colour string, and doing that ~300 times a
frame cost more than all the geometry put together.

### Leaves letting go

A leaf detaches somewhere in the canopy, tumbles down, comes to rest on the
stone and fades out; then another one goes. Continuous, and slow enough to
notice without ever demanding attention. Resting leaves are drawn flat on the
paving alongside the static scatter, and all of them clear as the code sharpens.

### Weather

The weather field drifts across the viewport in two layers — one behind the
scene, one in front — from a single pool sized for the heaviest of them, so
changing season never reallocates.

Leaves and petals tumble as they fall: width is scaled by `|cos(flip)|`, so each
one pinches to an edge and swells open again as it turns over. That
foreshortening is the whole trick; without it they read as drifting confetti.

The two layers are not decoration alone. In the scan view the front layer fades
out and only the back layer remains, drifting *behind* the card — so nothing
ever floats across a symbol somebody is trying to scan.

### The code is in the paving from the start

The plaza is laid with the code before anything happens: every dark module is
drawn into the stonework at about 13% of the way from paving to ink — legible if
you look for it, easy to miss if you don't. Leaves landing don't *create* the
pattern so much as finish it, painting each module up to full strength as they
arrive.

That is one extra row-batched pass over the modules that have yet to land;
landed ones are painted over at full strength by the tops pass, so the finished
code is unaffected.

Leaves that came down earlier lie scattered on the stone, and clear away as the
code sharpens — nothing is resting on it by the time you go to scan.

### The code lies on the floor

The reveal leaves the finished code where it was assembled — painted across the
plaza, seen at an angle, with the season carrying on around it. The camera only
lifts from 35° to about 54°: enough to read the whole plot, still plainly a
floor you are looking across rather than a diagram.

Two ramps run independently, which is what makes this work. `inkT` drives the
plaza to white-on-black as the code forms, so it reads while the sky, weather
and grass stay exactly as they were. The full bleach-out is reserved for the
scan view.

The paving checker fades out along that same ramp. It is texture, not data — if
it stayed, every light module would finish a shade darker than the quiet zone
around it, and that is contrast taken straight off what a scanner has to work
with.

**It scans as it lies.** All four seasons decode straight off the isometric
plaza, so the angled view costs nothing.

### The scan view

The ⛶ button swings the camera overhead and lifts the code onto a floating white
card — a slow bob, a slower sway, and a shadow that tightens as it sinks. The
roll is capped at about **0.6°**: a bobbing code still scans, a tilting one
starts to struggle, so the motion is nearly all translation.

It is a deliberate second gear rather than where the reveal ends. Asking for it
while the tree is still standing reveals the code first, so the button always
does something sensible; dropping back to the tree puts the camera back on the
plaza.

### Leaves

Every dark module of the code is a leaf. A short URL has only a few hundred, far
too sparse for a canopy, so the surplus is **blossom that carries no data**: it
hangs on the branches, and the gust tears it away and carries it out of frame
while the encoding leaves stay behind and land. Chaff and signal, separating in
front of you.

The blossom count is chosen so a dense 25×25 canopy and a sparse 53×53 one both
land at about 2,100 leaves, which keeps the look and the frame cost constant
across URL lengths.

---

## Quick start

Open `dist/yozakura.html` in a browser — that's it.

To work on the source instead, serve the folder and open `src/index.html`:

```bash
python3 serve.py 4173
```

Then rebuild the single-file version after any change:

```bash
python3 build.py
```

## Changing where the code points

**The everyday way.** Type into the *Destination URL* field. The code re-encodes
as you type; the status line under it tells you which QR version and error
correction level you ended up with.

**Under *Redirect & encoding*** there are four controls:

| Control | What it does |
| --- | --- |
| **What the code points at** | `Straight to the destination` puts the URL inside the code itself — most reliable, but reprinting is the only way to change it later. `Through this page` encodes a link back to this page carrying the destination, so anyone who scans sees the animation before they arrive. |
| **Link base for scanned codes** | The host those "through this page" links point at. Defaults to wherever the page is being served from; set it to your production domain while building codes locally, or to a short link you control so a printed code can be re-pointed later. Remembered in `localStorage`. |
| **Auto-continue after reveal** | Off, or a 3/5/10-second countdown before a visitor is forwarded to the destination. With it off they get a plain *Go* button. |
| **Error correction** | `L` through `H`. Higher tolerates more damage and dirt at the cost of a denser code. `M` is boosted to `Q` automatically whenever that costs nothing. |

### Link format

Share links look like `?q=<base64url>&go=<seconds>`. The decoded payload is two
digits of style followed by the destination:

```
"03https://example.org/landing"
 ││└── URL
 │└─── accent index (0-5)
 └──── sky index (0-3)
```

The page distinguishes two ways of arriving:

- **`?q=…` in the query string** means someone scanned a code. The page reveals
  itself automatically and offers to continue to the destination.
- **`#q=…` in the hash** is the editor's own session state, written on every
  change so a reload restores your work in progress.

That split matters — without it, refreshing while building a code would be
indistinguishable from someone scanning it, and you'd get bounced to the
destination you were editing.

## Project layout

```
yozakura/
├── src/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── qr.js       QR Model 2 encoder, versions 1-40, ECC L/M/Q/H
│       ├── scene.js    isometric renderer, tree growth, reveal choreography
│       ├── audio.js    synthesised wind and chime (off by default)
│       └── app.js      themes, controls, link encoding, redirect handling
├── dist/
│   ├── yozakura.html   single self-contained page — open or share this
│   ├── index.html      identical bytes, named for a static host
│   └── artifact.html   same page as body content, for Claude Artifacts
├── test/verify.html    encoder round-trip suite
├── build.py            inlines src/ into dist/
└── serve.py            local static server
```

## Tuning the animation

Every phase boundary lives in one table at the top of `src/js/scene.js`:

```js
const T = {
  revealDuration: 2900,
  regrowDuration: 2400,
  gust:    [0.00, 0.18],  // wind ramps, canopy shivers
  flight:  [0.06, 0.62],  // leaves detach and fly to their modules
  sink:    [0.40, 0.58],  // trunk withdraws into the ground
  tilt:    [0.52, 0.86],  // camera swings to straight-down
  flatten: [0.62, 0.90],  // blocks collapse to paint
  lock:    [0.86, 1.00]   // contrast snaps, scan-line sweeps
};
```

Numbers are fractions of the whole reveal, so phases can overlap freely. A few
other knobs worth knowing:

- **Landing order** — each leaf's `priority` in `_buildTree` decides when it
  flies. Finder patterns are hard-coded to go first, since they're the anchors a
  scanner hunts for and it reads as intent rather than randomness.
- **Block height** — `blockH` in `draw()` is measured in *cell* units, not as a
  fraction of the grid. That's deliberate: tie it to grid size and a 53-module
  code grows blocks so tall their sides bury the light modules between them.
- **Tree shape** — seeded from the QR's version and mask, so a given URL always
  grows the same tree.
- **Framing** — `_fit` deliberately frames only about two thirds of the crown.
  The outer blossom bleeds off the sides, which fills the stage and reads as a
  canopy you're standing under rather than a specimen on a plinth.
- **Blossom volume** — `fillerCount` in `_buildTree`, currently tuned so any URL
  lands near 3,600 leaves. The single biggest lever on how lush the tree looks,
  and on frame cost.
- **Crown shape** — foliage hangs off mid-branch nodes as well as the outermost
  tips. Without those interior nodes the crown widens into a hollow ring.
- **Weather** — `FALL` / `SWAY` / `SLANT` in `_updateAmbient` set how each kind
  moves; `weather.count` per season sets how much of it there is.
- **Latent code** — the `0.13` in the latent pass of `_drawGround` is how plainly
  the code shows through the paving before the reveal.
- **Foliage placement** — `sites` in `_buildTree` samples points along the whole
  length of every branch, not just its tip, which is what makes the canopy look
  grown rather than stuck on.
- **The verge** — grass grows in tufts, not evenly, which is most of what makes
  it read as planted rather than scattered. `tufts` and the per-tuft `count` in
  `_buildGrass` control density; each blade is two quadratic curves meeting at
  the tip so it tapers like a real one, and about one in eighteen carries a
  wildflower drawn from the blossom palette.
- **Camera drift** — the three sinusoids in `_cinematic`.

## Notes on the rendering

Everything is one 2D canvas. The camera is orthographic with a `pitch` that
animates from isometric (35°) to straight-down (90°), which is what turns the
skewed floor pattern into something a phone can actually read.

The one non-obvious performance rule: **canvas rasterises a path in time that
grows faster than the number of subpaths in it.** Batching the whole 53×53 floor
into a single path was *12× slower* than one fill per tile; flushing a row at a
time is 2.7× faster than either. Geometry is therefore flushed in chunks of
roughly 48 subpaths throughout. Once the blocks collapse to paint, the floor is
a two-colour bitmap drawn with a single transformed `drawImage`.

Leaves are bucketed by colour *and* by quantised alpha, so a whole cloud of
fading blossom costs a handful of fills. Each leaf is a four-point pointed oval
— the same vertex count as the rectangle it replaced, but it reads as blossom
instead of confetti and fills fewer pixels.

Measured worst frame on Night — the heaviest scene, with stars, bloom and
3,400 leaves — is **4.7 ms**, best-of-three after a long warm-up, with progress
pinned each frame.

Two traps, both of which cost me real time:

- **Warm up first, then take the best of several runs.** Cold samples run
  4–10× slow. A "bloom is expensive" reading that disappears when you remove
  the *vignette* instead is drift, not attribution.
- **Pin `progress` on every frame you time.** Leaving `state` as `'revealing'`
  lets `update()` advance the reveal while you measure, so the run quietly
  finishes and reports the cost of the settled state — about 0.1 ms — for
  whatever progress you thought you were measuring.

And if a number looks impossible, check `scene.canvas.width` before believing
it. A collapsed preview pane silently resizes the canvas to 2×2, at which point
nothing decodes and every timing is meaningless.

**Load**: the webfont stylesheet is loaded without blocking first paint
(`media="print"`, swapped on load). That alone took `DOMContentLoaded` from
436 ms to about 35 ms — the actual init work, building a 3,600-leaf tree and
encoding the code, is only ~50 ms of it.

The reveal itself runs **1.8 s**, down from 2.9 s, with the phases front-loaded
so the code arrives sooner.

Because petals never stop falling there is no idle frame to skip, so the loop
runs continuously; the settled state costs about 0.2 ms, and the loop is
released entirely while the tab is hidden.

## Verifying the encoder

`test/verify.html` encodes a battery of payloads — ASCII, Unicode, numeric,
alphanumeric, very long — across versions 1-31 and all four EC levels, renders
each to a canvas, and reads it back with the browser's native `BarcodeDetector`
(macOS Vision). Every symbol must round-trip to the exact input string.

```bash
python3 serve.py 4173   # then open http://127.0.0.1:4173/test/verify.html
```

Current status: **208 / 208 pass**. The rendered scene itself decodes from about
70% of the way through the reveal onward, so the code is readable well before the
animation settles.

Requires a Chromium-based browser — `BarcodeDetector` is what makes this an
independent check rather than the encoder grading its own homework.

## Putting it on nextlvl.win

nextlvl.win is a Cloudflare Pages site with an SPA fallback — every unknown
path returns the homepage — so a subpath cannot be added without redeploying
that site. Yozakura therefore ships as its own Pages project on a subdomain:

```bash
wrangler login          # once
./deploy.sh             # build and publish
```

Then attach `yozakura.nextlvl.win` to the project as a custom domain. Because
the zone is already on Cloudflare, the DNS record is created for you.

`deploy.sh` publishes a directory containing only the page itself, so the
Artifacts fragment and the duplicate build in `dist/` are never served. It is
one file, no server, no build step on the host — the only network request it
makes is the Google Fonts stylesheet.

To put it on a path of the main site instead, copy `dist/index.html` into that
site's source at `yozakura/index.html` and deploy it the way you normally do.

The link base defaults to wherever the page is served from, so once it is at
`https://nextlvl.win/yozakura/` every link it makes looks like:

```
https://nextlvl.win/yozakura/?q=MTBodHRwczovL25leHRsdmwud2lu…
```

Nothing to configure. If you later move it, or want links to run through a
short domain you control, set **Link base** under *Redirect & encoding* and it
is remembered locally.

### The two sides of it

Opening `/yozakura/` with no query lands in the **builder**: type a
destination, pick a scene, copy your link.

Opening one of those links lands in **visitor mode**: the builder is hidden
entirely, the garden gets the whole screen, the code resolves on its own, and
the way onward is the only control — with *Make your own* tucked underneath for
anyone curious enough to follow it back. That is the shape worth linking to
from a projects section.

## Licence

MIT — see `LICENSE`. Swap it for whatever you prefer; nothing here constrains
the choice.

Credits and trademark notices live in `NOTICE.md`, including the QR Code
trademark, the specification the encoder is built against, and the concept this
grew out of. Worth a read before making the repository public.

## Browser support

Modern Chrome, Safari, Firefox and Edge. `prefers-reduced-motion` is honoured
throughout — the reveal snaps between states instead of animating, palettes swap
without a cross-fade, no petals fall, the card does not float, and the
auto-cycle stays off. Opening `dist/index.html`
straight off disk works, with one caveat: `file://` isn't a secure context, so
*Copy* falls back to `document.execCommand` and `localStorage` may be unavailable
(both are wrapped in try/catch).
