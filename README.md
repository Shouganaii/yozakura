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

## The moon

You are standing under a cherry tree, looking up at a full moon through it. A
bare trunk runs up the near edge of the frame; boughs reach in from the trunk
and from three sides, and blossom veils the moon on every side but the middle.
The code lies latent in the moon's *maria* — the dark patches on its face —
faint enough to miss and legible if you look for it.

Tap it and the blossom lets go: it lifts off the branches, sweeps across the
face on a bowed path, and settles into those patches until the code is solid.
The foreground scales outward about the moon and fades as it goes, so the camera
reads as pushing up through the blossom rather than the tree sliding aside — the
only move that works when boughs come in from several different edges.

Three moods, all of them night:

| | Sky | Moon | Blossom |
| --- | --- | --- | --- |
| Hanami | `#0a0616` → `#231539` | warm ivory | pink |
| Frost | `#05080f` → `#16243a` | blue-white | white |
| Ember | `#12060e` → `#3a1424` | harvest gold | crimson |

### No projection

The garden this replaced was isometric, and most of its renderer was projection
maths. There is none here. The moon is a disc, the code is a square inscribed in
it, and the bough is drawn in screen space — which means the code is always
axis-aligned and always square, with no perspective for a scanner to undo. That
is a large part of why the redesign made the thing simpler rather than harder.

`src/js/moon.js` replaces `scene.js` wholesale, keeping the same `Grove.Scene`
interface so the app layer never learned which scene it is driving.

### Fitting a square in a circle

The code's square has to stay inside the disc — a corner spilling onto the night
sky stops the quiet zone being a quiet zone, and the code stops scanning. The
inscribed square that touches the limb exactly is `1.41r`; this uses **`1.28r`**
so the corners keep a margin. That constraint is what sets how large the moon
has to be, not the other way round.

### The face is one image

Moonlight, latent maria and filled-in modules are painted into a single
one-pixel-per-module bitmap and put down with one `drawImage`, clipped to the
disc. Repainting `n²` pixels of `ImageData` each frame is cheaper than drawing
hundreds of rectangles, and it keeps the code perfectly crisp with image
smoothing off.

### Blossom

One blossom per dark module, plus blossom that carries no data so the tree looks
laden rather than counted out — about 2,000 in total. Each is a five-petal sakura
sampled around a raised-cosine lobe, so the petals are broad and the notch
between them narrow; alternating two radii instead gives an asterisk.

Placement rules, each learned by breaking it and looking at the result:

- **Sites run the length of every limb**, not just its tip. Hanging blossom off
  the nodes alone gives a row of discrete pom-poms.
- **Sites are few and wide, not many and tight.** Many tight ones sleeve each
  limb in an even tube of pink, like a pipe cleaner.
- **Spread stays small** — a fixed fraction of the viewport, not of the branch
  length. Scaled to length, a depth-0 node threw blossom across a quarter of the
  screen and the canopy detached from the bough entirely.
- **Density falls off toward the middle of the disc.** Blossom veils the moon,
  but the centre is where the code has to read, so a blossom landing there is
  kept with a probability that drops to about one in eight at the middle. A hard
  cut-off instead leaves a hole that looks stamped out.

Finder patterns settle first. They are what a scanner hunts for, and watching
the three corners arrive ahead of everything else reads as intent.


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
│       ├── moon.js     the moon, the bough, and the reveal choreography
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
  revealDuration: 2000,
  regrowDuration: 1500,
  gust:     [0.00, 0.16],   // the bough shivers, blossom begins to let go
  flight:   [0.04, 0.62],   // blossom crosses to the moon and settles
  withdraw: [0.34, 0.70],   // the emptied bough draws back off frame
  ink:      [0.30, 0.88],   // the face brightens, the modules go dark
  lock:     [0.80, 1.00]    // halo swells, a light sweeps the face
};
```

Numbers are fractions of the whole reveal, so phases can overlap freely. Other
knobs worth knowing, all in `src/js/moon.js`:

- **Moon size and the inscribed square** — `_moon()`. The `1.28` multiplier is
  the one number you cannot raise carelessly: past `1.41` the code's corners
  leave the disc and the quiet zone is gone.
- **Landing order** — each blossom's `priority` in `_buildBlossoms`. Finder
  patterns are hard-coded to go first.
- **Blossom volume** — the target total in `_buildBlossoms`, tuned so any URL
  lands near the same number. The biggest lever on how laden the tree looks, and
  on frame cost.
- **The tree** — `_buildBranch`. The trunk is a bow angle shared across its
  segments rather than a per-step turn; as a per-step constant it accumulated
  and swung the whole trunk off frame. `arms` is where each bough enters and how
  far it reaches — long reaches lattice the moon's face into panes.
- **The keep-clear zone** — `clearCentre` in `_buildBlossoms`.
- **Wind** — `_swayAt`. Amplitude grows with limb depth, the motion is mostly
  vertical, and `phase` runs out along each limb so the lift travels rather than
  the whole tree pulsing in time. Raising the frequencies past about `1.0` stops
  reading as wind and starts reading as a wobble.
- **Bark** — `bark()` seeds the lenticels per limb; `_barkMarks` draws them.
  Limbs at least 9px across get a gradient across their width, thinner ones get
  three flat tones.
- **Blossom placement** — `sites` samples along the length of every limb, and
  `spread` is a fixed fraction of the viewport rather than of branch length.
  Both matter; see the note above on what breaking either looks like.
- **Tree shape** is seeded from the QR's version and mask, so a given URL always
  grows the same tree.
- **How plainly the code shows before the reveal** — the `maria` tone per mood,
  and the `1 - inkT * 0.15` blend in `draw()`.

## Notes on the rendering

Everything is one 2D canvas, drawn in screen space. There is no camera and no
projection — see *No projection* above.

**Nothing on the tree animates on its own.** Every blossom still attached and
every limb it hangs from samples one shared sway field, so a cluster and its
branch move as a single object. Giving each petal its own phase — which is what
this did at first — reads as shimmer rather than wind: from any distance,
independent jitter averages out to no motion at all, just noise. Only what has
let go tumbles.

Wide limbs are filled with a gradient across their width and thin ones with
three flat tones. Stacking discrete width passes, which is how the thick limbs
were drawn first, banded the trunk into vertical stripes and read as bamboo.

The one non-obvious performance rule, carried over from the scene this replaced:
**canvas rasterises a path in time that grows faster than the number of subpaths
in it.** Batching a whole 53×53 grid into a single path measured *12× slower*
than one fill per tile, while flushing a row at a time was 2.7× faster than
either. Blossom is therefore stamped in chunks of about 40 subpaths, bucketed by
colour and quantised alpha.

Leaves are bucketed by colour *and* by quantised alpha, so a whole cloud of
fading blossom costs a handful of fills. Each leaf is a four-point pointed oval
— the same vertex count as the rectangle it replaced, but it reads as blossom
instead of confetti and fills fewer pixels.

Measured worst frame with the tree at full blossom — about 2,000 sakura, 520
limb segments of which 106 take a gradient apiece, the lenticels, the star field
and the halo — is **2.7 ms**, best-of-three after a long warm-up, with progress
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

Live at **https://yozakura-qr-tree.pages.dev** — that is the Pages project name,
and it is baked into `deploy.sh` as the default. Pages projects cannot be
renamed in place; changing it means creating a new project, deploying, and
deleting the old one, which breaks every link already generated against the old
host.

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
entirely, the scene gets the whole screen, the code resolves on its own, and
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
