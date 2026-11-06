# Ajooba Footwear — creative image and video prompt library

**Status:** production briefs, ready to hand to a retoucher or a generator.
**Owner:** creative direction.
**Companions:** `docs/design-build-plan.md` (why the page looks like this),
`docs/ux-audit-findings.md` (what was wrong before), `docs/catalog-audit.md`
(the catalogue as it actually is: 55 designs, 674 variants, 12 colours).

---

## 0. What this document is for

The storefront is built as a **specimen catalogue**: one shoe, alone on a flat
tint, at a consistent scale, named plainly, with one fact beside it
(`.specimen` in `apps/storefront/src/app/globals.css`). That format is honest
because Ajooba's own photography already is it — square studio frames on a
light ground, shot design by design by the workshop.

The build therefore ships **no invented imagery**. There is no stock photograph
of someone else's factory, no generated shoe standing in for a SKU that has not
been photographed, and no moving picture at all, because no honest clip exists
yet. This document is the brief for the imagery that is genuinely missing, so
that the gap can be closed with real production work rather than filled with
fiction.

There are three jobs in here:

| Job                                                                      | Section | Why it is needed                                                            |
| ------------------------------------------------------------------------ | ------- | --------------------------------------------------------------------------- |
| **Campaign stills** for the fields and bands the layout already reserves | §3      | The layout has slots with no photograph; they currently hold type on a tint |
| **One moving picture** — the hero loop, and two smaller loops            | §4, §5  | The direction asks for one moving picture; none exists                      |
| **The craft set** — workshop, hands, lasts, thread                       | §6      | `/about` argues the product is hand-finished and shows no evidence          |

---

## 1. The rule that governs every prompt here

> **A generated image may set a mood. It may never stand in for a product a
> customer can buy.**

Concretely:

- **Never** generate a fake photograph of a selling design (A01–A57) and present
  it as that design. The catalogue's real photography is the only thing allowed
  on a product tile, a gallery, or a colour swatch.
- Generated stills are for **atmosphere and craft context**: fields, light,
  materials, hands, the workshop, the closing band. Those are exactly the slots
  the build left empty rather than faking.
- Any generated still that ends up on a page must be **labelled in the repo**
  (a `source` note beside the file, and a line in this document's §8 log) so a
  later editor cannot mistake it for documentary photography.
- People in generated images must not be presented as **named** staff,
  customers or reviewers. No invented testimonials, no invented guest list.

This is not squeamishness. The whole visual argument of the site is _"this is
what the object actually looks like"_. One fabricated product photograph
destroys the argument for every other tile on the page.

---

## 2. The visual constant (locked — do not vary between prompts)

Every generated still in this library must be able to sit next to a real
catalogue photograph on the same page without breaking the set. That means
holding six things constant.

| Constant    | Value                                                                                                                                                     | Why                                                                                                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ground**  | One seamless, evenly lit backdrop, near-white warm grey (`#f2efe9`–`#f7f4ee`). No gradient, no vignette, no visible sweep line, no texture.               | `.specimen img` uses `mix-blend-mode: multiply`, so a near-white ground drops out and the object appears to sit _on_ the tint. A mid-grey or coloured ground shows as a dirty rectangle. |
| **Light**   | One large soft source from upper-left, roughly 45°, plus one dim fill from the right. No visible catchlight beyond a soft sheen.                          | Matches the workshop's existing set-ups so generated and real frames key the same.                                                                                                       |
| **Shadow**  | Contact shadow only — a soft, short, low-opacity pool directly under the object. **No cast shadow to the side, no floating object, no reflection floor.** | The layout has no shadow anywhere else; a floored object reads as a different set.                                                                                                       |
| **Angle**   | Three-quarter front, camera slightly above the shoe's midline (≈15°), shoe pointing to the lower-right. **One angle for a whole family of shots.**        | The site compares like with like; two shoes at different angles cannot be compared.                                                                                                      |
| **Framing** | Object fills ~72–80% of the frame width, centred, whole object in frame with clear space above the toe and behind the heel. Nothing cropped.              | `.specimen` adds 8% padding and `object-contain`; an object that already fills the frame edge-to-edge loses its margin.                                                                  |
| **Finish**  | Photographic, not rendered. Visible material truth: grain, stitch irregularity, thread sheen, dust in the crevice of a sole. Slight, even film grain.     | A CGI-perfect shoe on a page of real photographed shoes is the tell that breaks the set.                                                                                                 |

**Do not** include: text, logos, watermarks, framing devices, borders, props
(rulers, boxes, petals, fabric swatches), feet, models, or multiple colourways
in one frame.

**Palette to hold (from `globals.css`, unchanged brand values):**
ink `#0b1424` · gold `#c9a24a` · cream `#fdfaf2` · claret `#9c1b3a`
Fields: `#efe7d6` · `#e3e7e1` · `#ece3e1` · `#e6e7ee` · `#f0ece2`

---

## 3. Campaign stills

These fill the layout's reserved photograph slots. Each brief below is a
**complete** prompt: paste the block, keep the settings line, and adjust only
the bracketed variables.

### 3.1 Model families and settings

Two families are worth using, for different reasons:

| Use                                                                 | Model                                                                                                      | Why                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product-adjacent stills that must hold a specific object's identity | **FLUX.2 [pro]** (`flux-2-pro`, fixed snapshot) with the real catalogue photograph attached as a reference | Takes a **seed**, so a shot you like can be reproduced; up to 8 API references; exact-hex colour control. Reproducibility matters more than novelty when the output sits beside real photography. |
| Atmosphere, craft, light, wide campaign plates                      | **FLUX 3 Image**                                                                                           | Best in class on fine detail and text, up to 10 references. **No seed** — save every output you want to keep.                                                                                     |
| Anything where a reviewer will ask "why does it look slightly off"  | **Midjourney V8.2** (`--raw`)                                                                              | Strongest at light and mood; weakest at holding a specific product's identity. Use for §6 craft only.                                                                                             |

### 3.2 Master prompt — craft atmosphere (workshop bench, no people)

```text
Editorial still life photographed on a plain warm-grey studio backdrop,
no props other than the ones named. A single hand-finished Indian mojri in
mid-construction resting on a worn wooden last, the upper turned inside out
and the sole not yet attached, a spool of zari thread and a curved awl laid
beside it at rest. Late afternoon window light from upper left, soft and
slightly warm, one dim fill from the right. Contact shadow only. Visible
material truth: suede nap, uneven hand stitching along the top line, a
faint chalk mark on the leather, sawdust in the grain of the bench.
Shallow depth of field, 50mm equivalent, camera slightly above the bench.
Photographic, not rendered. No text, no logo, no watermark, no hands,
no feet, no model.
```

```text
--ar 4:5  --raw  --s 50  (Midjourney V8.2)
seed: unset
```

**Acceptance:** the leather must look used, not new; the stitching must be
visibly hand-worked (varying pitch, not machined-even); nothing in frame
resolves into readable text.

### 3.3 Master prompt — the closing band plate

The closing band (`story-callout.tsx`) is type on a tinted field today. This
brief gives it a photograph that argues the same sentence.

```text
A wide, quiet studio still life on a plain warm-grey backdrop: five
hand-finished Indian shoes arranged in a loose single row, each a different
design — a gold-embroidered ivory mojri, a black patent lace-up derby, a
brown leather horsebit loafer, a tan cross-strap sandal, a black suede
tassel loafer. All five sit on the same ground, seen from the same
three-quarter angle, at the same apparent scale, evenly spaced with air
between them. Soft directional light from upper left; short contact shadows
only. The shoes are worn, not new: creases across the vamp, faint scuffing
at the toe, a dulled sheen on the patent. Photographic, film grain, muted
warm palette. No people, no text, no logos, no props, no reflections.
```

```text
--ar 16:9  --raw  --s 75  (Midjourney V8.2)
```

**Acceptance:** the five shoes read as one _set_, the way a field guide plate
reads — same scale, same angle, same light. If one shoe is lit differently,
regenerate; that is the whole point of the plate.

### 3.4 Master prompt — material macro (for `/about` and the craft section)

```text
Extreme close macro of gold zari embroidery on ivory suede, raking light
from the right at a low angle so each metallic thread throws a short
highlight and the suede nap stands up in the shadow. The stitching is
hand-worked: pitch varies slightly, one thread end is visible and not quite
tucked. Fine detail, high micro-contrast, natural colour, no oversharpening.
Photographic, not rendered.
```

```text
--ar 1:1  --raw  --s 40  (Midjourney V8.2)
```

**Acceptance:** at 100% the thread must show individual filaments. A plastic
sheen or a perfectly regular stitch pattern fails the brief.

### 3.5 Per-category treatment notes

The catalogue's four subcategories are not one family, and the stills should
not pretend they are. Where a generated still is needed for a category
_banner_ (never for a product tile), hold the category's own character:

| Subcategory (slug)                | Designs | What the frame must communicate                                                                                       | What to avoid                                                       |
| --------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **Mojri & Jutti** (`mojri-jutti`) | 21      | Ceremony: gold zari, beadwork, pearl; the sole's slight lift at the toe; a hint of the occasion without a wedding set | Marigolds, mandalas, henna hands, red silk — the whole cliché shelf |
| **Formal shoes** (`shoe`)         | 29      | The working wardrobe: patent gloss reflecting one hard highlight, welt stitching, the shape of a good last            | Boardroom props, briefcases, watches, men's-legs crops              |
| **Sandals** (`sandal`)            | 4       | Warm-weather ease: buckle hardware, adjustable straps, a footbed that has taken weight                                | Beach sand, palm shadows, resort styling                            |
| **Chappal** (`chappal`)           | 1       | Everyday Indian leather: flat sole, hand-cut strap, honest wear                                                       | Anything that reads "artisanal souvenir"                            |

> Only **one** design in the catalogue is a Chappal (A28) and only **four** are
> sandals. A campaign plate weighted toward formal shoes is therefore the
> honest weighting — do not build a hero that implies a balanced four-way
> collection.

---

## 4. The hero video

This is the one moving picture the site wants. It replaces nothing — the
specimen hero stays — and it belongs in the **closing band** and on `/about`,
not on the first screen, because the first screen's job is to show one object
clearly and a video there competes with it.

### 4.1 Reference frame (this is the part that decides the output)

Seedance 2.5 **takes its output aspect ratio from the first-frame image**, and
it animates _that_ composition rather than inventing a new one. The still is
therefore the whole brief. Shoot or generate the still to this spec:

| Requirement     | Value                                                                                                                                           |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Aspect ratio    | **16:9** (the plate is a wide band). Decided here, not in the prompt.                                                                           |
| Resolution      | ≥ 1920 × 1080 (the model accepts sides from 300–6000 px; ratio between 0.4 and 2.5)                                                             |
| Format          | JPEG or PNG, under 30 MB                                                                                                                        |
| Content         | The 3.3 five-shoe plate, or a single design at the same angle — **but the frame's left third must be calm empty ground** for the copy to sit on |
| Motion headroom | Nothing may be cropped by the frame edge; the camera needs room to move without revealing the edge of the backdrop                              |
| Faces           | None. (If a human face ever appears, the API requires `input_image_has_face: true` or the request can be filtered.)                             |

### 4.2 Prompt — "the dust settles"

```text
@Image 1 is the first frame. Preserve its composition, the row of five
shoes, the plain backdrop, the single soft key from the upper left, and the
camera's height and direction. The shoes stay exactly as they are: one
continuous object each, no shape change, no colour shift, no added or
removed details.

Motion: a very slow, steady lateral dolly to the right, about half a shoe
width over the whole clip, as if the camera is drifting past a display.
Between 0.4s and 0.8s a single mote of dust drifts down through the light
in the left third of the frame and lands out of focus on the ground. The
light warms very slightly across the clip, as if a cloud passed and
cleared. Nothing else moves. The clip ends with the composition still
intact and the dolly still in motion, so it can be cut into a loop.

Audio: near silence. One soft, distant room tone. No music.
```

```text
model: seedance-2.5  mode: image_to_video
image: plate-16x9.jpg
last_image: unset
duration: 6
resolution: 1080p
generate_audio: false
```

**Why `generate_audio: false`:** the site must not autoplay sound, and a
generated room tone that does not match the page is worse than silence. Strip
audio at encode.

**Looping:** the clip is built to cut back to itself — the dolly is still
moving at the cut, and the dust mote is gone by then. If a visible seam
survives, re-run with the _same still_ supplied as `last_image` so the first
and last frames match; verify the seam at 100% before shipping, and treat the
identical-frame approach as a technique to test rather than a guarantee.

**Encode:**

- MP4 (H.264, yuv420p, CRF 22) **and** WebM (VP9) at 1920 × 1080
- 6s, no audio track, `faststart`
- poster frame: the first frame as JPEG at q82, ≤ 90 kB
- total weight budget **≤ 2.2 MB for the MP4**

### 4.3 Prompt — "the object returns" (single design, tighter)

```text
@Image 1 is the first frame. Preserve the composition, the single mojri at
centre, the warm-grey backdrop, and the key light from the upper left. The
shoe remains one continuous object: the embroidered upper, the sole edge
and the top line must not deform, and the gold thread must keep its exact
pattern.

Motion: the camera pushes in slowly and slightly, about 6% over the clip,
ending marginally closer to the toe. Simultaneously the key light narrows
into a soft band that travels from the heel toward the toe, lifting the
gold embroidery one row of stitches at a time and settling on the toe box
by 4.5s. The shoe does not move, rotate or breathe.

Audio: none.
```

```text
model: seedance-2.5  mode: image_to_video
image: mojri-hero-16x9.png
duration: 5
resolution: 1080p
generate_audio: false
```

**Acceptance for both:** watch at 100% and check the embroidery pattern is
byte-stable frame to frame. A single drifting stitch is the failure mode that
makes a generated product clip unusable.

---

## 5. The two smaller loops

### 5.1 Product-page loop (4:5)

Plays muted and looping beside or under the gallery, **only on designs whose
real photography already exists** — the loop animates the real still, it does
not replace it. Run this over the real catalogue frame for a flagship design
(e.g. the ivory embroidered mojri family), not over a generated one.

Reference frame: the real catalogue image, canvas-extended to 4:5 with the
matching backdrop colour so nothing is cropped.

```text
@Image 1 is the first frame. Preserve the shoe exactly: shape, colour,
stitch pattern, sole edge and the existing contact shadow. Do not add or
remove detail.

Motion: an extremely slow orbit of the light, not the object. The shoe
stays perfectly still while the highlight travels across the upper from
left to right and back, as though a window passed overhead. One soft
specular glint crosses the buckle hardware at 2.5s. Depth of field stays
constant.

Audio: none.
```

```text
model: seedance-2.5  mode: image_to_video
image: <real catalogue frame, 4:5>
duration: 5
resolution: 720p  (a PDP loop is decorative; 720p is enough, and 1080p quadruples the bytes)
generate_audio: false
```

Deliver 1080 × 1350 MP4 + WebM, ≤ 900 kB, poster ≤ 60 kB. **Only ever load it
on interaction or when it enters the viewport** — a 900 kB autoplay on a phone
on 3G is a worse experience than a still.

### 5.2 Category loop (1:1)

Same technique, used once on the Mojri & Jutti category header. Three real
mojris at the specimen angle; the camera drifts, the light travels.

```text
@Image 1 is the first frame. Preserve the three shoes, their order, spacing,
scale and the plain backdrop. Each shoe remains one continuous object.

Motion: a slow, even pan from left to right across the three shoes, about
one shoe width in total, with the focus plane staying on the centre shoe.
As the frame travels, the two outer shoes pass slightly out of focus and
back. A faint breath of dust moves across the ground in the second half.

Audio: none.
```

```text
model: seedance-2.5  mode: image_to_video
image: mojri-category-1x1.png
duration: 6
resolution: 720p
generate_audio: false
```

---

## 6. The craft set (the honest gap on `/about`)

`/about` currently claims hand-embroidery, vegetable-tanned leather,
stitched-and-cemented soles and small-batch cutting, and shows **no
photographs at all**. That is the single largest credibility gap on the site,
and it is the one place where the answer is not generation: it is a morning
with a camera in the workshop.

**Brief for a real shoot (preferred, ~half a day):**

1. Bench at working height, hands in frame, one operation per frame —
   cutting, skiving, lasting, stitching, sole-attaching, packing.
2. The lasts themselves: rows of wooden lasts, worn, named in pencil.
3. Thread and findings: zari spools, buckles, sole sheets, stacked.
4. The room: window light, the bench, the wall, nobody posed.
5. One portrait of the maker **with consent and a name** — or no portrait at
   all. An unnamed stock craftsman is worse than none.

Frame all of it horizontally at 3:2 and vertically at 4:5 so both the
`/about` prose column and a future story band can use it.

**If generation is used as an interim placeholder**, use §3.2 only, keep it
labelled in the repo, and replace it before launch.

---

## 7. Delivery specification

| Asset                         | Aspect | Delivery size   | Format              | Budget   |
| ----------------------------- | ------ | --------------- | ------------------- | -------- |
| Campaign plate (closing band) | 16:9   | 2400 × 1350     | JPEG q82 + WebP q80 | ≤ 220 kB |
| Specimen-adjacent still       | 4:5    | 1600 × 2000     | JPEG q82 + WebP q80 | ≤ 180 kB |
| Material macro                | 1:1    | 1400 × 1400     | JPEG q82 + WebP q80 | ≤ 150 kB |
| Hero loop                     | 16:9   | 1920 × 1080, 6s | MP4 H.264 + WebM    | ≤ 2.2 MB |
| PDP loop                      | 4:5    | 1080 × 1350, 5s | MP4 + WebM          | ≤ 900 kB |
| Category loop                 | 1:1    | 1080 × 1080, 6s | MP4 + WebM          | ≤ 1.0 MB |

**Naming** (mirrors the catalogue convention in `docs/catalog-audit.md` §6):

```
public/creative/<slug>-<width>x<height>.<ext>
public/creative/<slug>-<width>x<height>.mp4
public/creative/<slug>-<width>x<height>.webm
public/creative/<slug>-poster.jpg
```

Lowercase, hyphenated, no spaces — the catalogue's own filenames carry legacy
spaces and mixed case and the import pipeline has to normalise them; new assets
must not repeat that.

**Every still needs**, in this order: `alt` text that describes the _object_
(not the mood), explicit `width`/`height` on the element, `loading="lazy"`
below the fold, and `fetchPriority="high"` only on the one image that is the
LCP candidate. Decorative fields stay `aria-hidden`.

**Every video needs**: `poster`, `muted`, `loop`, `playsInline`,
`preload="none"`, and `prefers-reduced-motion` must fall back to the poster —
the build's existing reduce-motion rule collapses every duration, and a video
is exempt from that only if it is not started at all.

---

## 8. Provenance log (fill this in as assets land)

Every generated asset that ships must be recorded here, so a later editor can
tell documentary from generated work.

| File       | Model | Prompt section | Date | Notes                                                                                               |
| ---------- | ----- | -------------- | ---- | --------------------------------------------------------------------------------------------------- |
| _none yet_ | —     | —              | —    | No generated or new photographic asset has been shipped. The build deliberately ships without them. |

---

## 9. What this library deliberately does not do

- It does not generate any of the 55 selling designs. Their photography exists
  and is authoritative; a generated stand-in would be a lie on a buy button.
- It does not invent people, names, reviews, or a "guest list".
- It does not supply a video for the first screen. The specimen hero is the
  first screen, and its argument is stillness and comparison.
- It does not dress the shoe in props or sets. The site's claim is that the
  object alone is worth looking at; props concede the argument.
