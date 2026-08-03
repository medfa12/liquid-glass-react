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
