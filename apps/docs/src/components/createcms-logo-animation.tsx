'use client';

/**
 * createCMS — animated logo (logo-path based).
 *
 * The mark IS the real logo (SVG paths), so the resting state is pixel-identical
 * to the brand logo and renders the same on every browser — no font measurement,
 * so none of the WebKit/iOS text-metric issues.
 *
 * Animation (plays once on mount; respects prefers-reduced-motion):
 *   1. "createCMS" is typed — each letter is its OWN path and pops in one by one
 *      (no clip, so letters never get sliced), with a caret at the edge.
 *   2. "(" auto-closes ")" tight (cursor between); "{" auto-closes "}" tight —
 *      like a code editor, the brackets start narrow.
 *   3. Feature words morph inside the braces (text), spreading the closing
 *      brackets outward as they grow.
 *   4. Resolves to the resting logo createCMS({▪}).
 */

import type { CSSProperties } from 'react';

import { useEffect, useRef } from 'react';

export interface CreateCMSLogoAnimationProps {
  words?: string[];
  wordDuration?: number;
  autoPlay?: boolean;
  respectReducedMotion?: boolean;
  ink?: string;
  accent?: string;
  fontFamily?: string;
  maxWidth?: string;
  className?: string;
  style?: CSSProperties;
}

const DEFAULT_WORDS = [
  'roots',
  'blocks',
  'media',
  'branches',
  'commits',
  'diffs',
  'reviews',
  'notifications',
  'merges',
  'publications',
  'rollbacks',
  'type-safe',
  'plugins',
  'multi-tenant',
  'a/b',
  'i18n',
];

// --- logo geometry (from createCMS-logo.svg, viewBox 0 0 1365 163) -----------
const LOGO_H = 163;

// Per-letter paths of "createCMS" (split from the logo's combined paths, so each
// glyph can pop in whole). `ink` = false → accent colour (the "CMS").
const LETTERS: { d: string; ink: boolean }[] = [
  {
    ink: true,
    d: 'M83.32,84.91l27.26-1.43c-2.87-25.42-24.39-41-50.43-41-32.39,0-53.71,22.35-53.71,56.79s21.32,56.78,53.71,56.78c26.86,0,48.18-16.2,51.25-42.43l-27.47-1.24c-2.05,14.56-11.68,22.15-23.78,22.15-16.81,0-26.44-12.92-26.44-35.26s9.63-35.27,26.44-35.27c11.48,0,21.12,7.38,23.17,20.91Z',
  }, // c
  {
    ink: true,
    d: 'M127.67,44.94v108.65h26.65v-61.91c0-17.43,7.18-26.03,24.6-26.03h10.46v-20.71h-10.25c-13.94,0-21.94,6.97-26.04,21.11l-.62-21.11h-24.8Z',
  }, // r
  {
    ink: true,
    d: 'M195.19,99.27c0,34.44,21.32,56.78,53.71,56.78,23.57,0,43.25-12.92,49.61-33.83l-27.06-2.04c-3.89,9.42-12.71,14.96-22.55,14.96-15.38,0-24.81-10.66-26.03-28.7h77.28l-.2-6.56c-.41-38.54-23.17-57.4-51.05-57.4-32.39,0-53.71,22.35-53.71,56.79h0ZM223.27,88.81c2.06-15.78,11.28-25.42,25.63-25.42,11.48,0,21.73,6.97,23.78,25.42h-49.41Z',
  }, // e
  {
    ink: true,
    d: 'M317.24,77.94l27.06,1.65c2.67-11.9,10.05-18.05,21.53-18.05,14.14,0,21.11,8,21.32,24.4l-30.55,6.15c-25.42,5.13-41,11.89-41,33,0,19.28,17.22,30.96,38.95,30.96,18.86,0,31.16-8.2,36.08-18.86,2.05,16.81,19.48,16.61,27.88,16.61l6.15-.21v-19.27h-4.1c-4.1,0-6.76-1.64-6.76-7.99v-37.11c0-30.55-16.61-46.74-47.97-46.74-26.65,0-44.28,13.12-48.59,35.46h0ZM342.87,124.28c0-12.51,10.45-13.94,24.19-16.61l20.5-3.69v1.23c0,21.53-11.07,32.19-25.83,32.19-12.71,0-18.86-5.75-18.86-13.12h0Z',
  }, // a
  {
    ink: true,
    d: 'M445.24,20.34v24.6h-17.02v20.5h17.02v54.74c0,22.13,12.09,33.41,34.44,33.41h20.91v-20.71h-16.4c-8.2,0-12.3-4.3-12.3-12.7v-54.74h28.7v-20.5h-28.7v-24.6s-26.65,0-26.65,0Z',
  }, // t
  {
    ink: true,
    d: 'M510.5,99.27c0,34.44,21.32,56.78,53.71,56.78,23.58,0,43.26-12.92,49.61-33.83l-27.06-2.04c-3.89,9.42-12.71,14.96-22.55,14.96-15.37,0-24.8-10.66-26.03-28.7h77.28l-.2-6.56c-.41-38.54-23.17-57.4-51.05-57.4-32.39,0-53.71,22.35-53.71,56.79ZM538.59,88.81c2.05-15.78,11.27-25.42,25.62-25.42,11.48,0,21.73,6.97,23.78,25.42h-49.4Z',
  }, // e
  {
    ink: false,
    d: 'M760.68,102.75l-28.29-1.44c-3.49,20.5-15.79,31.98-34.04,31.98-27.88,0-40.58-23.16-40.58-52.27s12.5-52.69,40.58-52.69c17.43,0,29.53,10.46,33.42,29.32l28.08-1.43c-6.35-31.99-28.28-51.46-61.08-51.46-42.85,0-68.68,33.41-68.68,76.26s26.03,75.85,68.68,75.85c34.44,0,56.17-20.5,61.91-54.12Z',
  }, // C
  {
    ink: false,
    d: 'M780.64,8.04v145.55h26.85V54.16l36.29,99.22h26.03l36.08-99.22v99.43h27.06V8.04h-36.28l-39.98,112.55-39.77-112.55h-36.28,0Z',
  }, // M
  {
    ink: false,
    d: 'M984.48,104.59l-27.06,1.64c2.26,30.35,26.45,49.82,60.88,49.82,29.73,0,54.13-14.96,54.13-42.43,0-22.97-20.92-36.7-51.25-44.08-15.99-4.1-33.01-8.2-33.42-22.55-.21-11.48,10.04-19.07,24.6-19.07,16.81,0,28.5,10.46,30.55,26.45l27.05-1.23c-3.27-28.7-24.8-48.38-57.19-48.38s-52.48,16.19-52.48,42.02c0,23.58,20.7,35.88,49.61,42.85,24.6,6.35,35.06,13.12,35.06,25.21.2,11.69-10.25,17.84-25.63,17.84-19.88,0-31.57-11.07-34.85-28.09h0Z',
  }, // S
];
const PAREN_L =
  'M1131.57,7.06h-20.01c-31.29,47.71-31.29,99.35,0,147.06h20.01c-28.05-49.08-28.05-97.98,0-147.06Z';
const BRACE_L =
  'M1132.33,71.36v18.46c10.26-.34,16.08,6.33,16.08,20.18v14.19c0,18.47,14.36,31.47,34.88,31.47h8.04v-18.98c-15.56.51-22.06-3.93-22.06-14.88v-12.65c0-15.56-9.41-26.68-23.26-28.39v-.68c13.68-1.71,23.26-12.66,23.26-28.05v-12.65c0-10.6,6.5-15.05,22.06-14.37V5.52h-8.04c-20.52,0-34.88,13-34.88,31.46v14.2c0,13.85-5.82,20.52-16.08,20.18Z';
const BRACE_R =
  'M1315.33,89.82v-18.46c-10.26.34-16.08-6.33-16.08-20.18v-14.2c0-18.46-14.36-31.46-34.88-31.46h-8.04v19.49c15.56-.68,22.06,3.77,22.06,14.37v12.65c0,15.39,9.58,26.34,23.26,28.05v.68c-13.85,1.71-23.26,12.83-23.26,28.39v12.65c0,10.95-6.5,15.39-22.06,14.88v18.98h8.04c20.52,0,34.88-13,34.88-31.47v-14.19c0-13.85,5.82-20.52,16.08-20.18Z';
const PAREN_R =
  'M1335.1,7.06h-20.01c28.05,49.08,28.05,97.98,0,147.06h20.01c31.29-47.71,31.29-99.35,0-147.06Z';
const BLOCK = { x: 1192.33, y: 49.81, w: 63, h: 62, rx: 17 };

// Right edge (logo units) of each letter — drives the caret during typing.
const LETTER_END = [127, 195, 317, 445, 510, 614, 770, 957, 1100];
const TYPED_W = LETTER_END[LETTER_END.length - 1];
const GLYPH_COUNT = LETTERS.length;

// Auto-close: how far the right brackets sit LEFT of their resting (spread)
// position when there is no content yet — so they start tight like an editor.
const PAREN_TIGHT = -120; // ")" near "(" before "{}" exist (room for the caret)
const BRACE_TIGHT = -20; //  "}"/")" near "{" before the words (room for the caret)
// caret LEFT edge = gap centre − half the caret width (12/2), so it sits evenly.
const PARENS_TIGHT_MID = 1157; // ("(" right 1132 + ")" left 1195)/2 − 6
const BRACES_TIGHT_MID = 1207; // ("{" right 1191 + "}" left 1236)/2 − 6

// Morph words sit just inside "{"; the right brackets slide to wrap them.
const WORD_X = 1200;
const WORD_FS = 112; // SAME for every word (no per-word scaling)
const WORD_Y = 75; // baseline so the words' x-height centres in the brackets
const BRACE_GROUP_X = 1255; // resting left edge of the "}/block" zone
const WORD_RESERVE = 760; // wide enough for the longest word at WORD_FS, un-scaled

const VIEWBOX_W = 1365 + WORD_RESERVE;
const UNIT_PX = 0.48;

// --- pure helpers ------------------------------------------------------------
const clamp = (x: number, lo: number, hi: number) =>
  x < lo ? lo : x > hi ? hi : x;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a), 0, 1);
const easeOut = (u: number) => 1 - Math.pow(1 - u, 4); // strong ease-out (punchy entrances)
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

    const gfx = (sel: string) => svg.querySelector(sel) as SVGGraphicsElement;
    const txt = (sel: string) =>
      svg.querySelector(sel) as SVGTextContentElement;
    const letters = LETTERS.map((_, i) => gfx(`[data-l="${i}"]`));
    const caret = gfx('[data-caret]');
    const parenL = gfx('[data-pl]');
    const braceL = gfx('[data-bl]');
    const braceR = gfx('[data-br]'); // "}" — slides right to wrap a word
    const parenR = gfx('[data-pr]'); // ")" — slides right to wrap a word
    const blk = gfx('[data-blk]');
    const feats = [txt('[data-feat]'), txt('[data-feat2]')];
    const FEAT = words;
    const N = FEAT.length;

    for (const e of [...letters]) {
      e.style.setProperty('transform-box', 'fill-box');
      e.style.transformOrigin = '50% 100%'; // grow up from the baseline
    }
    for (const e of [
      parenL,
      braceL,
      braceR,
      parenR,
      blk,
      caret,
      feats[0],
      feats[1],
    ]) {
      e.style.setProperty('transform-box', 'fill-box');
      e.style.transformOrigin = 'center';
    }
    feats[0].style.transformOrigin = feats[1].style.transformOrigin = '0% 50%';

    // --- timeline (ms) ---
    const TYPE_START = 1700; // caret blinks a couple of times at the far left first
    const MS_PER_GLYPH = 95;
    const TYPING_END = TYPE_START + GLYPH_COUNT * MS_PER_GLYPH;
    const PAREN_AT = TYPING_END + 150; // type "(" → "(" + ")" appear tight
    const BRACE_AT = PAREN_AT + 270; //  type "{" → "{" + "}" appear tight
    const REVEAL_DUR = 150;
    const BLINK_START = BRACE_AT + 200; // caret settles between the braces…
    const FEAT_START = BLINK_START + 1700; // …blinks a moment longer, then the first word
    const STEP = Math.max(320, wordDuration);
    const FEAT_IN = Math.min(500, STEP * 0.5);
    const FEAT_OUT = Math.min(420, STEP * 0.42); // exits snappier than enters
    const BLOCK_START = FEAT_START + N * STEP;
    const BLOCK_DUR = 620;
    const END = BLOCK_START + BLOCK_DUR + 240;

    let braceShift: number[] = FEAT.map(() => 0);
    const measureWords = () => {
      // Every word renders at the SAME size (no scaling) — only the closing
      // brackets move to wrap it (clamped so they never leave the viewBox).
      braceShift = [];
      feats[0].style.opacity = '0';
      FEAT.forEach((f, i) => {
        feats[0].textContent = f;
        const w = feats[0].getComputedTextLength();
        braceShift[i] = clamp(
          Math.round(WORD_X + w + 12 - BRACE_GROUP_X),
          0,
          WORD_RESERVE,
        );
      });
      feats[0].textContent = '';
    };

    const glyphsTyped = (t: number) =>
      t < TYPE_START
        ? 0
        : clamp(
            Math.floor((t - TYPE_START) / MS_PER_GLYPH) + 1,
            0,
            GLYPH_COUNT,
          );

    const wordVis = (t: number, i: number) => {
      const start = FEAT_START + i * STEP;
      const BLUR = 13;
      if (t < start) return { op: 0, bl: BLUR, sx: 0.93, sy: 0.93 };
      if (t <= start + FEAT_IN) {
        const u = easeInOut(seg(t, start, start + FEAT_IN));
        return {
          op: u,
          bl: lerp(BLUR, 0, u),
          sx: lerp(0.93, 1, u),
          sy: lerp(0.93, 1, u),
        };
      }
      if (t < start + STEP) return { op: 1, bl: 0, sx: 1, sy: 1 };
      if (t <= start + STEP + FEAT_OUT) {
        const u = easeInOut(seg(t, start + STEP, start + STEP + FEAT_OUT));
        return {
          op: 1 - u,
          bl: lerp(0, BLUR, u),
          sx: lerp(1, 1.05, u),
          sy: lerp(1, 1.05, u),
        };
      }
      return { op: 0, bl: BLUR, sx: 1.05, sy: 1.05 };
    };

    // Shift of "}" (and ")") from rest: tight before the words, spreading per
    // word, settling to 0 (the resting block) at the end.
    const braceX = (t: number) => {
      if (t < FEAT_START) return BRACE_TIGHT;
      if (t >= BLOCK_START) {
        return lerp(
          braceShift[N - 1],
          0,
          easeInOut(seg(t, BLOCK_START, BLOCK_START + FEAT_OUT)),
        );
      }
      const i = clamp(Math.floor((t - FEAT_START) / STEP), 0, N - 1);
      const start = FEAT_START + i * STEP;
      const cur = braceShift[i];
      const prev = i === 0 ? BRACE_TIGHT : braceShift[i - 1];
      const inOp = easeInOut(seg(t, start, start + FEAT_IN));
      const outOp = 1 - easeInOut(seg(t, start, start + FEAT_OUT));
      const s = inOp + outOp;
      return s < 0.001 ? cur : (cur * inOp + prev * outOp) / s;
    };

    // ")" hugs "(" until "{ }" appear, then it joins "}" (spreading for words).
    const parenX = (t: number) => {
      if (t < BRACE_AT) return PAREN_TIGHT;
      return lerp(
        PAREN_TIGHT,
        braceX(t),
        easeOut(seg(t, BRACE_AT, BRACE_AT + 160)),
      );
    };

    const reveal = (t: number, t0: number) => ({
      op: t < t0 ? 0 : easeOut(seg(t, t0, t0 + REVEAL_DUR)),
      sc: t < t0 ? 0.7 : lerp(0.7, 1, easeBackOut(seg(t, t0, t0 + REVEAL_DUR))),
    });

    const renderAt = (t: number) => {
      const typed = glyphsTyped(t);

      // Typing: each letter is its own path and pops in whole (opacity + a small
      // scale) — no clip, so no slicing of adjacent glyphs.
      for (let i = 0; i < GLYPH_COUNT; i++) {
        const at = TYPE_START + i * MS_PER_GLYPH;
        if (t >= at) {
          letters[i].style.opacity = '1';
          letters[i].style.transform =
            `scale(${lerp(0.86, 1, easeOut(seg(t, at, at + 90))).toFixed(3)})`;
        } else {
          letters[i].style.opacity = '0';
          letters[i].style.transform = 'scale(0.86)';
        }
      }

      // Caret: steps after each typed letter, then to the centre of the tight
      // "( )", then the tight "{ }"; blinks and fades as the first word arrives.
      let caretX: number;
      if (t < PAREN_AT) {
        caretX =
          typed <= 0
            ? 6
            : typed >= GLYPH_COUNT
              ? TYPED_W
              : LETTER_END[typed - 1];
      } else if (t < BRACE_AT) {
        caretX = lerp(
          TYPED_W,
          PARENS_TIGHT_MID,
          easeOut(seg(t, PAREN_AT, PAREN_AT + 130)),
        );
      } else {
        caretX = lerp(
          PARENS_TIGHT_MID,
          BRACES_TIGHT_MID,
          easeOut(seg(t, BRACE_AT, BRACE_AT + 130)),
        );
      }
      let caretOp: number;
      if (t < TYPE_START) caretOp = Math.floor(t / 520) % 2 === 0 ? 1 : 0;
      else if (t < BLINK_START) caretOp = 1;
      else {
        const on = Math.floor((t - BLINK_START) / 520) % 2 === 0 ? 1 : 0;
        caretOp = on * (1 - seg(t, FEAT_START - 200, FEAT_START));
      }
      caret.style.opacity = caretOp.toFixed(3);
      caret.style.transform = `translateX(${(caretX - 6).toFixed(1)}px)`;

      // Auto-closing brackets: left ones fixed, right ones start tight and
      // spread. "(" + ")" pop together; "{" + "}" pop together.
      const bx = braceX(t);
      const px = parenX(t);
      const rPar = reveal(t, PAREN_AT);
      const rBr = reveal(t, BRACE_AT);
      parenL.style.opacity = String(rPar.op);
      parenL.style.transform = `scale(${rPar.sc.toFixed(3)})`;
      parenR.style.opacity = String(rPar.op);
      parenR.style.transform = `translateX(${px.toFixed(1)}px) scale(${rPar.sc.toFixed(3)})`;
      braceL.style.opacity = String(rBr.op);
      braceL.style.transform = `scale(${rBr.sc.toFixed(3)})`;
      braceR.style.opacity = String(rBr.op);
      braceR.style.transform = `translateX(${bx.toFixed(1)}px) scale(${rBr.sc.toFixed(3)})`;

      // Two slots ping-pong so adjacent words cross-fade.
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
          u < 0.6
            ? lerp(0, 1.16, easeOut(u / 0.6))
            : lerp(1.16, 1, easeInOut((u - 0.6) / 0.4));
      }
      blk.style.opacity = blockOp.toFixed(3);
      blk.style.transform = `scale(${blockScale.toFixed(3)})`;
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
      measureWords();
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
        viewBox={`0 0 ${VIEWBOX_W} ${LOGO_H}`}
        aria-hidden
        style={{
          fontFamily,
          width: `min(${Math.round(VIEWBOX_W * UNIT_PX)}px, ${maxWidth})`,
          height: 'auto',
          display: 'block',
          overflow: 'visible',
        }}
      >
        {/* "createCMS" — one path per letter, popped in individually. */}
        {LETTERS.map((l, i) => (
          <path
            key={i}
            data-l={i}
            d={l.d}
            style={{ fill: l.ink ? ink : accent, opacity: 0 }}
          />
        ))}
        {/* Brackets — real logo paths; right ones (}/) ) slide to wrap words.
            Start hidden so the pre-JS frame is just the caret, not "({▪})". */}
        <path data-pl d={PAREN_L} style={{ fill: ink, opacity: 0 }} />
        <path data-bl d={BRACE_L} style={{ fill: ink, opacity: 0 }} />
        <path data-br d={BRACE_R} style={{ fill: ink, opacity: 0 }} />
        <path data-pr d={PAREN_R} style={{ fill: ink, opacity: 0 }} />
        {/* Morph words (text) at the logo's fixed brace coordinates. */}
        <text
          data-feat
          x={WORD_X}
          y={WORD_Y}
          fontWeight="600"
          fontSize={WORD_FS}
          textAnchor="start"
          dominantBaseline="central"
          style={{ fill: accent }}
        ></text>
        <text
          data-feat2
          x={WORD_X}
          y={WORD_Y}
          fontWeight="600"
          fontSize={WORD_FS}
          textAnchor="start"
          dominantBaseline="central"
          style={{ fill: accent }}
        ></text>
        <rect
          data-blk
          x={BLOCK.x}
          y={BLOCK.y}
          width={BLOCK.w}
          height={BLOCK.h}
          rx={BLOCK.rx}
          style={{ fill: accent, opacity: 0 }}
        />
        {/* Typing caret — cap height of the capitals (y≈8 to baseline ≈154). */}
        <rect
          data-caret
          x="6"
          y="8"
          width="12"
          height="146"
          rx="3"
          style={{ fill: accent, opacity: 0 }}
        />
      </svg>
    </span>
  );
}
