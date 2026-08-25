# Notices and credits

Yozakura is original work — no third-party source is vendored into this
repository, and nothing here was copied from another codebase. These are the
acknowledgements that belong with it anyway.

## QR Code

**QR Code** is a registered trademark of DENSO WAVE INCORPORATED. The symbology
is published as ISO/IEC 18004 and is free to implement; DENSO WAVE does not
exercise its patent rights against implementations of the standard.

`src/js/qr.js` was written against that specification. The numeric tables in it
— error-correction codewords and block counts per version, alignment-pattern
positions, the mask penalty constants — are values fixed by the standard rather
than anything invented here.

Its *structure* follows the approach taken by Project Nayuki's widely-used
QR Code generator: deriving the block split arithmetically from two small
tables rather than carrying the full 160-row table, and the seven-run sliding
history used to score finder-lookalikes when picking a mask. That approach was
reconstructed from familiarity with it, not copied from the source. Nayuki's
library is MIT licensed, which permits commercial use with attribution, so this
acknowledgement is offered in that spirit.

## Concept

The idea of a tree whose leaves resolve into a scannable QR code is derived
from [tree.icqr.com](https://tree.icqr.com). None of their code was read or
reused — the encoder, renderer and animation here were all built from scratch,
and the visual identity is deliberately its own. The concept credit is theirs.

## Typefaces

Loaded from Google Fonts at runtime rather than bundled:

- **Inter** — SIL Open Font License 1.1
- **Outfit** — SIL Open Font License 1.1
- **JetBrains Mono** — SIL Open Font License 1.1
- **Noto Sans JP** — SIL Open Font License 1.1

All four permit use, modification and redistribution, including commercially.

## Authorship

Written with Claude (Anthropic). Commits carry a `Co-Authored-By` trailer
recording that.
