# @liquid-glass/react

Liquid Glass for React, via WebGL2. Reverse-engineered from macOS 26/27's
QuartzCore shaders — see [`../README.md`](../README.md).

```bash
npm i @liquid-glass/react
```

```tsx
import { LiquidGlass, useDiffusion } from '@liquid-glass/react';

function Panel({ bg }: { bg: HTMLImageElement }) {
  const diffusion = useDiffusion(true);          // animated appear
  return (
    <LiquidGlass
      variant="regular"
      backdrop={bg}
      diffusion={diffusion}
      style={{ width: 320, height: 120 }}
    >
      <h3 style={{ padding: 16 }}>Hello</h3>
    </LiquidGlass>
  );
}
```

## `backdrop` is required

There is no way to read live backdrop pixels from a WebGL context — the browser
deliberately does not expose them (cross-origin leak). And `backdrop-filter`
cannot displace sampling per fragment, which is the entire effect.

So pass the backdrop yourself: an `<img>`, `<canvas>`, `<video>` (with
`backdropIsLive`), or an `ImageBitmap`. If you truly need arbitrary DOM behind
the glass, rasterize it (html2canvas or similar) and pass the canvas — slow and
imperfect; prefer designing so the backdrop is something you own.

## Requirements

**WebGL2.** There is no WebGL1 fallback: the blur is `textureLod()` against a mip
chain, which WebGL1 cannot express. `isSupported()` tells you; without it the
component renders a plain CSS blur, which looks like frosted glass, not liquid
glass.

## API

- `<LiquidGlass variant params backdrop backdropIsLive diffusion fallback />`
- `useDiffusion(visible, durationMs)` — drives the appear/disappear ramp
- `LiquidGlassRenderer` — the framework-agnostic core, if you want your own loop
- `preset('regular' | 'clear' | 'macos27')`, `defaultParams()`
- `FRAGMENT_SRC` / `VERTEX_SRC` — the raw ESSL 300, if you'd rather bring your own renderer

## Adaptive tint (chameleon)

The material — and the content on it — shifts with the backdrop, so symbols stay
legible: **dark glyphs over a bright backdrop, light glyphs over a dark one.**

Apple implements this with a GPU reduction (`tile_average_luma` ->
`compute_sum_luma` -> `compute_average_luma`) using **exactly Rec.709 weights**
(0.212646 / 0.715332 / 0.072205 — decoded from the fp16 immediates 0xH32CE,
0xH39B9, 0xH2C9F). The average is remapped through `luminanceColorMap.png`, a
256-entry curve that is a **logistic centred at 0.5 with k = 10.25**, running
0.349 -> 0.800. That is fit here to a closed form (max error 1.4/255), so no
lookup texture ships.

This implementation skips the reduction pass entirely: the average comes from
the **top mip** of the backdrop, which already exists because the blur needs a
full mip chain. Same number, zero extra passes.

Verified: backdrop luma 0.085 -> glass 0.140; backdrop 0.938 -> glass 0.311.

```
backdrop 0.00-0.35  ->  symbol luma 0.94-0.81   light
backdrop 0.50       ->  symbol luma 0.25        flips to dark
backdrop 0.65-1.00  ->  symbol luma 0.12        dark
```

The flip lands at 0.5 because that is where Apple centred the logistic — the
curve's midpoint *is* the decision point.

Use `adaptiveContentLuma(avgLuma)` to tint your own labels and glyphs from the
same curve the material uses.

## Fidelity

Measured against a real `NSGlassEffectView` capture on macOS 26.5.2, fitted by
coordinate descent driving the actual Metal shader headlessly:

| | |
|---|---|
| MAE | 15.0/255 |
| PSNR | **17.53 dB** |
| scale invariance | 240x150 vs 480x300 agree to 1.7/255 |

**This is not 1:1 with Apple**, and two gaps are structural rather than a matter
of more tuning:

1. The corner curve differs — `exponent = 6.5` (superellipse, fitted to 1011
   boundary pixels) against Apple's continuous curve.
2. macOS 27's material recipes live on the **encrypted** IPSW volume, so the
   three subsystems added in 27 (ring shadow, key fill highlight, blur fill)
   have no ground truth to fit against; their values are modelled, not measured.
