import React, {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { LiquidGlassRenderer, isSupported } from './renderer';
import { GlassParams, defaultParams, preset, PresetName } from './params';

export interface LiquidGlassProps {
  children?: React.ReactNode;
  /** Named preset to start from. */
  variant?: PresetName;
  /** Overrides merged over the preset. */
  params?: Partial<GlassParams>;
  /**
   * The backdrop. REQUIRED — see the note below on why this cannot be
   * automatic. Pass an <img>, <canvas>, <video>, or an ImageBitmap.
   */
  backdrop?: TexImageSource | null;
  /** Re-upload the backdrop every frame (for video / animated sources). */
  backdropIsLive?: boolean;
  /** 0 = absent, 1 = fully present. Animate for the appear/disappear effect. */
  diffusion?: number;
  /** Rendered when WebGL2 is unavailable. Defaults to a plain blurred div. */
  fallback?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * WHY YOU MUST SUPPLY THE BACKDROP
 *
 * The effect displaces where each fragment samples the backdrop — that is the
 * refraction. CSS `backdrop-filter` has no hook for this: it can blur and
 * colour-shift what is behind an element, but it cannot move where a given
 * pixel reads from. There is no way to obtain live backdrop pixels from inside
 * a WebGL context either; the browser deliberately does not expose them
 * (it would be a cross-origin leak).
 *
 * So the backdrop has to come from your side. In practice:
 *   - a static background image or gradient you already have → pass it directly
 *   - a <video> → pass the element, set backdropIsLive
 *   - arbitrary DOM behind the glass → rasterize it yourself (html2canvas or
 *     similar) and pass the canvas. This is slow and imperfect; prefer
 *     designing so the backdrop is something you own.
 */
export const LiquidGlass: React.FC<LiquidGlassProps> = ({
  children,
  variant = 'regular',
  params,
  backdrop,
  backdropIsLive = false,
  diffusion,
  fallback,
  className,
  style,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<LiquidGlassRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  const [supported] = useState(() => isSupported());
  const [size, setSize] = useState({ w: 0, h: 0 });

  const merged = useMemo<GlassParams>(() => {
    const base = variant ? preset(variant) : defaultParams();
    const p = { ...base, ...params };
    if (diffusion !== undefined) p.diffusion = diffusion;
    if (size.w > 0 && size.h > 0) p.halfSize = [size.w / 2, size.h / 2];
    return p;
  }, [variant, params, diffusion, size.w, size.h]);

  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!supported || !canvasRef.current) return;
    try {
      rendererRef.current = new LiquidGlassRenderer(canvasRef.current);
    } catch (e) {
      console.warn('[LiquidGlass]', e);
      return;
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [supported]);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r || !backdrop) return;
    r.setBackdrop({ kind: 'image', image: backdrop });
  }, [backdrop]);

  const draw = useCallback(() => {
    const r = rendererRef.current;
    if (!r || size.w === 0 || size.h === 0) return;
    if (backdropIsLive && backdrop) r.setBackdrop({ kind: 'image', image: backdrop });
    r.resize(size.w, size.h);
    r.render(merged);
  }, [merged, size.w, size.h, backdrop, backdropIsLive]);

  useEffect(() => {
    if (!backdropIsLive) {
      draw();
      return;
    }
    const tick = () => {
      draw();
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [draw, backdropIsLive]);

  const hostStyle: React.CSSProperties = {
    position: 'relative',
    isolation: 'isolate',
    ...style,
  };

  if (!supported) {
    return (
      <div ref={hostRef} className={className} style={hostStyle}>
        {fallback ?? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backdropFilter: 'blur(16px) saturate(1.8)',
              WebkitBackdropFilter: 'blur(16px) saturate(1.8)',
              background: 'rgba(255,255,255,0.10)',
              borderRadius: 24,
            }}
          />
        )}
        <div style={{ position: 'relative' }}>{children}</div>
      </div>
    );
  }

  return (
    <div ref={hostRef} className={className} style={hostStyle}>
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          pointerEvents: 'none',
        }}
      />
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
};

/**
 * Drives `diffusion` with the staggered appear/disappear ramp.
 * Returns a value in [0,1] to feed the component.
 */
export function useDiffusion(visible: boolean, durationMs = 420): number {
  const [v, setV] = useState(visible ? 1 : 0);
  const raf = useRef<number | null>(null);
  const start = useRef(0);
  const from = useRef(v);

  useEffect(() => {
    const target = visible ? 1 : 0;
    from.current = v;
    start.current = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start.current) / durationMs);
      const eased = t * t * (3 - 2 * t); // smoothstep
      setV(from.current + (target - from.current) * eased);
      if (t < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [visible, durationMs]);

  return v;
}
