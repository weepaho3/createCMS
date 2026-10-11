'use client';

import { useEffect, useRef, useState } from 'react';

type SceneProps = {
  /** Figure name under public/how-it-works, e.g. 'scene-0'. */
  name: string;
  /** Accessible title of the figure. */
  title: string;
  /** Height of the frame in CSS pixels. */
  height?: number;
};

type Theme = 'light' | 'dark';

/** The site theme, read from the `dark` class next-themes keeps on <html>. */
function useSiteTheme(): Theme {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    const root = document.documentElement;
    const read = () =>
      setTheme(root.classList.contains('dark') ? 'dark' : 'light');
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

/**
 * Embeds one of the standalone isometric figures built by scripts/figures.
 * The figure follows the site theme: it is loaded with `?theme=` and told about later changes through postMessage.
 */
export function Scene({ name, title, height = 560 }: SceneProps) {
  const theme = useSiteTheme();
  const frame = useRef<HTMLIFrameElement>(null);
  const [initial] = useState(theme);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ theme }, '*');
  }, [theme]);

  return (
    <iframe
      ref={frame}
      title={title}
      src={`/how-it-works/${name}.html?theme=${initial}`}
      loading="lazy"
      sandbox="allow-scripts"
      style={{
        width: '100%',
        height,
        border: 0,
        display: 'block',
        margin: '1.5rem 0',
      }}
    />
  );
}
