import { ImageResponse } from 'next/og';

// iOS "Add to Home Screen" uses the apple-touch-icon, which must be a PNG on a
// solid tile (iOS adds its own rounded corners). Next.js auto-links this route
// as <link rel="apple-touch-icon">.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

// The createCMS ({▪}) mark — fixed colours (no theme media query, since this is
// rasterised to a PNG). Square viewBox centred on the mark.
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="14 -56 272 272">
  <path fill="#1c1917" d="M58.24,6.47h-20.01c-31.29,47.71-31.29,99.35,0,147.06h20.01c-28.05-49.08-28.05-97.98,0-147.06Z"/>
  <path fill="#1c1917" d="M59,70.77v18.46c10.26-.34,16.08,6.33,16.08,20.18v14.19c0,18.47,14.36,31.47,34.88,31.47h8.04v-18.98c-15.56.51-22.06-3.93-22.06-14.88v-12.65c0-15.56-9.41-26.68-23.26-28.39v-.68c13.68-1.71,23.26-12.66,23.26-28.05v-12.65c0-10.6,6.5-15.05,22.06-14.37V4.93h-8.04c-20.52,0-34.88,13-34.88,31.46v14.2c0,13.85-5.82,20.52-16.08,20.18Z"/>
  <path fill="#1c1917" d="M242,89.23v-18.46c-10.26.34-16.08-6.33-16.08-20.18v-14.2c0-18.46-14.36-31.46-34.88-31.46h-8.04v19.49c15.56-.68,22.06,3.77,22.06,14.37v12.65c0,15.39,9.58,26.34,23.26,28.05v.68c-13.85,1.71-23.26,12.83-23.26,28.39v12.65c0,10.95-6.5,15.39-22.06,14.88v18.98h8.04c20.52,0,34.88-13,34.88-31.47v-14.19c0-13.85,5.82-20.52,16.08-20.18Z"/>
  <path fill="#1c1917" d="M261.77,6.47h-20.01c28.05,49.08,28.05,97.98,0,147.06h20.01c31.29-47.71,31.29-99.35,0-147.06Z"/>
  <rect fill="#ea580c" x="119" y="49" width="63" height="62" rx="17" ry="17"/>
</svg>`;

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#fafaf9',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          width={120}
          height={120}
          alt="createCMS"
          src={`data:image/svg+xml;utf8,${encodeURIComponent(MARK)}`}
        />
      </div>
    ),
    size,
  );
}
