import { ImageResponse } from 'next/og';

import {
  BRAND_ACCENT,
  BRAND_INK,
  BRAND_INK_INVERSE,
  COPY,
} from '@/lib/launch-copy';

export const OG_SIZE = { width: 1200, height: 630 };

// Same ({▪}) mark as `app/apple-icon.tsx`, with fills parameterized for the
// light brand sheet (ink on stone, accent square). No Fumadocs lavender.
function markDataUri(ink: string, accent: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 -56 272 272">
  <path fill="${ink}" d="M58.24,6.47h-20.01c-31.29,47.71-31.29,99.35,0,147.06h20.01c-28.05-49.08-28.05-97.98,0-147.06Z"/>
  <path fill="${ink}" d="M59,70.77v18.46c10.26-.34,16.08,6.33,16.08,20.18v14.19c0,18.47,14.36,31.47,34.88,31.47h8.04v-18.98c-15.56.51-22.06-3.93-22.06-14.88v-12.65c0-15.56-9.41-26.68-23.26-28.39v-.68c13.68-1.71,23.26-12.66,23.26-28.05v-12.65c0-10.6,6.5-15.05,22.06-14.37V4.93h-8.04c-20.52,0-34.88,13-34.88,31.46v14.2c0,13.85-5.82,20.52-16.08,20.18Z"/>
  <path fill="${ink}" d="M242,89.23v-18.46c-10.26.34-16.08-6.33-16.08-20.18v-14.2c0-18.46-14.36-31.46-34.88-31.46h-8.04v19.49c15.56-.68,22.06,3.77,22.06,14.37v12.65c0,15.39,9.58,26.34,23.26,28.05v.68c-13.85,1.71-23.26,12.83-23.26,28.39v12.65c0,10.95-6.5,15.39-22.06,14.88v18.98h8.04c20.52,0,34.88-13,34.88-31.47v-14.19c0-13.85,5.82,20.52,16.08,20.18Z"/>
  <path fill="${ink}" d="M261.77,6.47h-20.01c28.05,49.08,28.05,97.98,0,147.06h20.01c31.29-47.71,31.29-99.35,0-147.06Z"/>
  <rect fill="${accent}" x="119" y="49" width="63" height="62" rx="17" ry="17"/>
</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function BrandOgImage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        background: BRAND_INK_INVERSE,
        color: BRAND_INK,
        padding: '80px 88px 72px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          display: 'flex',
          width: '100%',
          height: 16,
          background: BRAND_ACCENT,
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          display: 'flex',
          width: 16,
          height: '100%',
          background: BRAND_ACCENT,
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          width={112}
          height={112}
          alt=""
          src={markDataUri(BRAND_INK, BRAND_ACCENT)}
        />
        <div
          style={{
            display: 'flex',
            fontSize: 36,
            fontWeight: 600,
            letterSpacing: -0.5,
          }}
        >
          {COPY.title}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div
          style={{
            display: 'flex',
            fontSize: 56,
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: -1.2,
          }}
        >
          {title}
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 30,
            lineHeight: 1.35,
            color: '#57534e',
          }}
        >
          {description}
        </div>
      </div>
    </div>
  );
}

export function generateBrandOgImage(props: {
  title: string;
  description: string;
}) {
  return new ImageResponse(<BrandOgImage {...props} />, OG_SIZE);
}
