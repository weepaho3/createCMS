'use client';

/**
 * createCMS — animated logo.
 *
 * Pure SVG + requestAnimationFrame, no deps. Types out `createCMS`, auto-closes
 * the `({ })`, morphs the feature words inside the braces, then resolves to the
 * resting mark `createCMS({▪})`. Plays once on mount; respects
 * prefers-reduced-motion (shows the resting mark instead).
 *
 * Colours are applied via inline `style={{ fill }}` (not the `fill` attribute)
 * so `ink` / `accent` may be CSS variables — the docs site passes
 * `var(--cc-ink)` / `var(--cc-accent)`, which the `.dark` class swaps for a
 * flash-free, JS-free theme adaptation.
 *
 * FONT: `fontFamily` must resolve to the loaded Geist (the docs site passes
 * `var(--font-geist-sans)`); per-glyph positions are measured from the real
 * font, so a wrong family misaligns the typed-out characters.
 */

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

export interface CreateCMSLogoAnimationProps {
  /** Words cycled inside the braces, in order. */
  words?: string[];
  /** ms each word stays fully visible before morphing (default 1000). */
  wordDuration?: number;
  /** Play once on mount (default true). When false, renders the resting mark. */
  autoPlay?: boolean;
  /** Render the resting mark when the user prefers reduced motion (default true). */
  respectReducedMotion?: boolean;
  /** Ink colour — "create" + the brackets (default #1C1917). */
  ink?: string;
  /** Accent colour — "CMS", the words and the block (default #EA580C). */
  accent?: string;
  /** Font family; must resolve to Geist for a pixel-exact mark. */
  fontFamily?: string;
  /** CSS cap for the rendered width (default '94vw'); the mark auto-sizes within it. */
  maxWidth?: string;
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_WORDS = [
  'roots', 'blocks', 'media', 'branches', 'commits', 'diffs', 'reviews', 'notifications',
  'merges', 'publications', 'rollbacks', 'type-safe', 'plugins', 'multi-tenant', 'a/b', 'i18n',
];

// "createCMS" — the first 6 glyphs ("create") are ink, the last 3 ("CMS") accent.
const SVG_NS = 'http://www.w3.org/2000/svg';
const GLYPHS = 'createCMS';
const GLYPH_COUNT = GLYPHS.length;
const INK_GLYPHS = 6;

// The mark's coordinate space is FIXED — same viewBox + rendered width on the
// server and after measurement — so there is NO layout shift. RESTING_W is the
// resting createCMS({▪}); WORD_RESERVE is the room the morphing words expand
// into (sized for the longest default word); the box reserves it up front
// instead of growing at runtime. UNIT_PX maps viewBox units to px (uncapped).
const RESTING_W = 1399;
const WORD_RESERVE = 1000;
const VIEWBOX_W = RESTING_W + WORD_RESERVE;
const UNIT_PX = 0.46;

// --- pure animation helpers ---------------------------------------------------
const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
/** Progress of `t` across the [a, b] window, clamped to [0, 1]. */
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);
const easeInOut = (u: number) =>
  u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const easeBackOut = (u: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
};

export default function CreateCMSLogoAnimation({
  words = DEFAULT_WORDS,
  wordDuration = 1000,
  autoPlay = true,
  respectReducedMotion = true,
  ink = '#1C1917',
  accent = '#EA580C',
  fontFamily = "'Geist', system-ui, sans-serif",
  maxWidth = '94vw',
  className,
  style,
}: CreateCMSLogoAnimationProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // --- elements ---
    const gfx = (sel: string) => svg.querySelector(sel) as SVGGraphicsElement;
    const txt = (sel: string) => svg.querySelector(sel) as SVGTextContentElement;
    const stage = gfx('[data-stage]');
    const wmg = gfx('[data-wmg]'); // static "createCMS" wordmark group
    const wm = txt('[data-wm]'); //  the measured wordmark text
    const p1 = gfx('[data-p1]'); //  (
    const b1 = gfx('[data-b1]'); //  {
    const b2 = gfx('[data-b2]'); //  }
    const p2 = gfx('[data-p2]'); //  )
    const blk = gfx('[data-blk]'); // resting block ▪
    const caret = gfx('[data-caret]');
    const feats = [txt('[data-feat]'), txt('[data-feat2]')]; // two ping-pong slots
    const FEAT = words;
    const N = FEAT.length;

    // Animate around each element's own centre (the words anchor at their left).
    for (const e of [p1, b1, b2, p2, blk, caret, feats[0], feats[1]]) {
      e.style.setProperty('transform-box', 'fill-box');
      e.style.transformOrigin = 'center';
    }
    feats[0].style.transformOrigin = feats[1].style.transformOrigin = '0% 50%';

    // --- timeline (ms) ---
    const TYPE_START = 400; //       first glyph appears
    const MS_PER_GLYPH = 86; //      typing cadence
    const PARENS_IN = 1240; //       "(" / ")" pop in
    const PARENS_IN_2 = 1310;
    const BRACES_IN = 1500; //       "{" / "}" pop in
    const BRACES_IN_2 = 1570;
    const REVEAL_DUR = 150; //       pop-in duration
    const BLINK_START = 1740; //     caret starts blinking
    const FEAT_START = 2420; //      first feature word
    const STEP = Math.max(320, wordDuration); // per-word slot length
    const FEAT_IN = Math.min(500, STEP * 0.5);
    const FEAT_OUT = Math.min(480, STEP * 0.48);
    const BLOCK_START = FEAT_START + N * STEP; // words done → resting block
    const BLOCK_DUR = 620;
    const END = BLOCK_START + BLOCK_DUR + 240;
    // X coordinates are anchored at the wordmark's pen (x=0) so the mark needs
    // no left-padding compensation. (Time constants above are unrelated.)
    const FEAT_X = 1207; //          left edge of the words
    const FEAT_PAD = 54; //          gap before the closing brace
    const BRACE_REST_X = 1278; //    resting x of the closing "}"
    const CARET_AT_PARENS = 1127;
    const CARET_AT_BRACES = 1207;
    // Swap the per-glyph typed text for the static wordmark once typing is done.
    const SWAP = TYPE_START + GLYPH_COUNT * MS_PER_GLYPH + 40;

    // --- measured at setup ---
    let boundary: number[] = [0]; // x of the caret after each typed glyph
    let braceShift: number[] = FEAT.map(() => 0); // per-word "}" shift
    let charG: SVGGElement | null = null; // the typed-out per-glyph layer
    const charEls: SVGTextElement[] = [];

    const glyphsTyped = (t: number) =>
      t < TYPE_START ? 0 : clamp(Math.floor((t - TYPE_START) / MS_PER_GLYPH) + 1, 0, GLYPH_COUNT);

    /** Opacity / blur / scale for word `i` at time `t` (fade-in, hold, fade-out). */
    const wordVis = (t: number, i: number) => {
      const start = FEAT_START + i * STEP;
      const BLUR = 13;
      if (t < start) return { op: 0, bl: BLUR, sx: 0.93, sy: 0.93 };
      if (t <= start + FEAT_IN) {
        const u = easeInOut(seg(t, start, start + FEAT_IN));
        return { op: u, bl: lerp(BLUR, 0, u), sx: lerp(0.93, 1, u), sy: lerp(0.93, 1, u) };
      }
      if (t < start + STEP) return { op: 1, bl: 0, sx: 1, sy: 1 };
      if (t <= start + STEP + FEAT_OUT) {
        const u = easeInOut(seg(t, start + STEP, start + STEP + FEAT_OUT));
        return { op: 1 - u, bl: lerp(0, BLUR, u), sx: lerp(1, 1.05, u), sy: lerp(1, 1.05, u) };
      }
      return { op: 0, bl: BLUR, sx: 1.05, sy: 1.05 };
    };

    /** How far the closing brace "}" sits right of rest, to wrap the current word. */
    const braceX = (t: number) => {
      if (t <= FEAT_START) return 0;
      if (t >= BLOCK_START) {
        return braceShift[N - 1] * (1 - easeInOut(seg(t, BLOCK_START, BLOCK_START + FEAT_OUT)));
      }
      const i = clamp(Math.floor((t - FEAT_START) / STEP), 0, N - 1);
      const start = FEAT_START + i * STEP;
      const cur = braceShift[i];
      if (i === 0) return lerp(0, cur, easeOut(seg(t, start, start + 240)));
      // Cross-fade the brace position between the outgoing and incoming word.
      const prev = braceShift[i - 1];
      const inOp = easeInOut(seg(t, start, start + FEAT_IN));
      const outOp = 1 - easeInOut(seg(t, start, start + FEAT_OUT));
      const s = inOp + outOp;
      return s < 0.001 ? cur : (cur * inOp + prev * outOp) / s;
    };

    /** Pop-in reveal (opacity + back-eased scale) starting at `t0`. */
    const reveal = (t: number, t0: number) => ({
      op: t < t0 ? 0 : easeOut(seg(t, t0, t0 + REVEAL_DUR)),
      sc: t < t0 ? 0.7 : lerp(0.7, 1, easeBackOut(seg(t, t0, t0 + REVEAL_DUR))),
    });

    const renderAt = (t: number) => {
      const bx = braceX(t);
      stage.removeAttribute('transform');

      // Typed glyphs while typing; swap to the static wordmark afterwards.
      if (t < SWAP) {
        wmg.style.display = 'none';
        if (charG) charG.style.display = '';
        for (let i = 0; i < GLYPH_COUNT; i++) {
          const at = TYPE_START + i * MS_PER_GLYPH;
          if (t >= at) {
            charEls[i].style.opacity = '1';
            charEls[i].style.transform = `scale(${lerp(0.84, 1, easeOut(seg(t, at, at + 90))).toFixed(3)})`;
          } else {
            charEls[i].style.opacity = '0';
            charEls[i].style.transform = 'scale(.84)';
          }
        }
      } else {
        if (charG) charG.style.display = 'none';
        wmg.style.display = '';
        wmg.style.clipPath = 'none';
      }

      // Caret: tracks the typing, parks at the parens then braces, then blinks
      // and fades out as the first word arrives.
      let caretX: number;
      let caretOp = 1;
      if (t < PARENS_IN) caretX = boundary[glyphsTyped(t)];
      else if (t < BRACES_IN) caretX = CARET_AT_PARENS;
      else if (t < BLINK_START) caretX = CARET_AT_BRACES;
      else {
        caretX = CARET_AT_BRACES;
        const on = Math.floor((t - BLINK_START) / 530) % 2 === 0 ? 1 : 0;
        caretOp = on * (1 - seg(t, FEAT_START - 200, FEAT_START));
      }
      caret.style.opacity = caretOp.toFixed(3);
      caret.style.transform = `translateX(${caretX.toFixed(1)}px)`;

      // Brackets pop in; the closing "}" and ")" also ride the brace shift.
      const r1 = reveal(t, PARENS_IN);
      const r2 = reveal(t, PARENS_IN_2);
      const rb1 = reveal(t, BRACES_IN);
      const rb2 = reveal(t, BRACES_IN_2);
      p1.style.opacity = String(r1.op);
      p1.style.transform = `scale(${r1.sc.toFixed(3)})`;
      p2.style.opacity = String(r2.op);
      p2.style.transform = `translateX(${bx.toFixed(1)}px) scale(${r2.sc.toFixed(3)})`;
      b1.style.opacity = String(rb1.op);
      b1.style.transform = `scale(${rb1.sc.toFixed(3)})`;
      b2.style.opacity = String(rb2.op);
      b2.style.transform = `translateX(${bx.toFixed(1)}px) scale(${rb2.sc.toFixed(3)})`;

      // Two slots ping-pong (even/odd words) so adjacent words can cross-fade.
      for (let slot = 0; slot < 2; slot++) {
        let best = -1;
        let bestV: ReturnType<typeof wordVis> | null = null;
        for (let i = slot; i < N; i += 2) {
          const v = wordVis(t, i);
          if (v.op > 0.001 && (best < 0 || v.op > bestV!.op)) {
            best = i;
            bestV = v;
          }
        }
        const el = feats[slot];
        if (best < 0 || !bestV) {
          el.style.opacity = '0';
        } else {
          if (el.textContent !== FEAT[best]) el.textContent = FEAT[best];
          el.style.opacity = bestV.op.toFixed(3);
          el.style.transform = `scale(${bestV.sx.toFixed(3)},${bestV.sy.toFixed(3)})`;
          el.style.filter = `blur(${bestV.bl.toFixed(2)}px)`;
        }
      }

      // Resting block ▪ overshoots in once the words are done.
      let blockOp = 0;
      let blockScale = 0;
      if (t >= BLOCK_START) {
        blockOp = easeOut(seg(t, BLOCK_START, BLOCK_START + 260));
        const u = seg(t, BLOCK_START, BLOCK_START + BLOCK_DUR);
        blockScale =
          u < 0.6 ? lerp(0, 1.16, easeOut(u / 0.6)) : lerp(1.16, 1, easeInOut((u - 0.6) / 0.4));
      }
      blk.style.opacity = blockOp.toFixed(3);
      blk.style.transform = `scale(${blockScale.toFixed(3)})`;
    };

    /** Measure glyph metrics, build the typed layer, and size the viewBox. */
    const setup = () => {
      wmg.style.display = '';
      wmg.style.clipPath = 'none';
      const box = wm.getBBox();

      // Caret x after each typed glyph (end position, with a measurement fallback).
      boundary = [box.x];
      for (let i = 0; i < GLYPH_COUNT; i++) {
        let x: number;
        try {
          x = wm.getEndPositionOfChar(i).x;
        } catch {
          x = box.x + wm.getSubStringLength(0, i + 1);
        }
        boundary[i + 1] = x;
      }

      // Build the per-glyph typed-out layer once.
      if (!charG) {
        charG = document.createElementNS(SVG_NS, 'g');
        for (let i = 0; i < GLYPH_COUNT; i++) {
          let sx: number;
          try {
            sx = wm.getStartPositionOfChar(i).x;
          } catch {
            sx = i ? boundary[i] : box.x;
          }
          const tx = document.createElementNS(SVG_NS, 'text');
          tx.setAttribute('x', String(sx));
          tx.setAttribute('y', '243');
          tx.setAttribute('font-weight', '600');
          tx.setAttribute('font-size', '205');
          tx.setAttribute('text-anchor', 'start');
          tx.style.fill = i < INK_GLYPHS ? ink : accent;
          tx.textContent = GLYPHS[i];
          tx.style.opacity = '0';
          tx.style.setProperty('transform-box', 'fill-box');
          tx.style.transformOrigin = '50% 100%';
          charG.appendChild(tx);
          charEls.push(tx as SVGTextElement);
        }
        stage.insertBefore(charG, wmg.nextSibling);
      }

      // Per-word "}" shift = how far the brace must move to wrap that word,
      // clamped to WORD_RESERVE so it never pushes past the FIXED viewBox (which
      // is set once in the JSX — setup no longer resizes the box, hence no
      // layout shift).
      feats[0].style.opacity = '0';
      braceShift = FEAT.map((f) => {
        feats[0].textContent = f;
        const w = feats[0].getComputedTextLength();
        return clamp(Math.round(FEAT_X + w + FEAT_PAD - BRACE_REST_X), 0, WORD_RESERVE);
      });
      feats[0].textContent = '';
    };

    // --- run once (no replay) ---
    let raf = 0;
    let elapsed = 0;
    let last: number | null = null;
    const frame = (now: number) => {
      if (last == null) last = now;
      elapsed += Math.min(now - last, 50); 
      last = now;
      renderAt(elapsed);
      if (elapsed < END) raf = requestAnimationFrame(frame);
      else {
        renderAt(END);
        raf = 0;
      }
    };

    const reduced =
      respectReducedMotion &&
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const start = () => {
      setup();
      if (reduced || !autoPlay) {
        renderAt(END);
        return;
      }
      renderAt(0);
      raf = requestAnimationFrame(frame);
    };

    if (document.fonts?.ready) document.fonts.ready.then(start, start);
    else start();

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [words, wordDuration, autoPlay, respectReducedMotion, ink, accent]);

  return (
    <span
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily,
        ...style,
      }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 78 ${VIEWBOX_W} 174`}
        aria-hidden
        style={{ fontFamily, width: `min(${Math.round(VIEWBOX_W * UNIT_PX)}px, ${maxWidth})`, height: 'auto', display: 'block', overflow: 'visible' }}
      >
        <g data-stage>
          <g data-wmg>
            <text data-wm x="0" y="243" fontWeight="600" fontSize="205" letterSpacing="-3" style={{ fill: ink }}>
              create<tspan style={{ fill: accent }}>CMS</tspan>
            </text>
          </g>
          {/* dominant-baseline is set on EACH <text> (not inherited from the
              <g>): Safari/iOS does not reliably inherit it, which dropped the
              brackets onto the alphabetic baseline (sitting too high). */}
          <g fontWeight="600" fontSize="171" textAnchor="middle" style={{ fill: ink }}>
            <text data-p1 x="1102" y="170" dominantBaseline="central">(</text>
            <text data-b1 x="1154" y="170" dominantBaseline="central">{'{'}</text>
            <text data-b2 x="1278" y="170" dominantBaseline="central">{'}'}</text>
            <text data-p2 x="1329" y="170" dominantBaseline="central">)</text>
          </g>
          <text data-feat x="1207" y="173" fontWeight="600" fontSize="140" textAnchor="start" dominantBaseline="central" style={{ fill: accent }}></text>
          <text data-feat2 x="1207" y="173" fontWeight="600" fontSize="140" textAnchor="start" dominantBaseline="central" style={{ fill: accent }}></text>
          <rect data-blk x="1184.5" y="146" width="63" height="62" rx="17" style={{ fill: accent }}></rect>
          {/* Caret base x=0 = the wordmark's left edge (it translateX-es along
              the typed glyphs); it rests invisible, so the static frame is fine. */}
          <rect data-caret x="0" y="96" width="9" height="150" rx="2" style={{ fill: accent }}></rect>
        </g>
      </svg>
    </span>
  );
}
