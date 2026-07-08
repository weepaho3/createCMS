import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: 'https://github.com/weepaho3/createCMS',
    nav: {
      // Theme-aware wordmark: the light file (dark ink) shows on light
      // backgrounds, the dark file (light ink) on dark — toggled purely by the
      // `.dark` class via CSS, so no client JS and no hydration flash.
      title: (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/createCMS-logo-light.svg"
            alt="createCMS"
            className="h-6 w-auto dark:hidden"
          />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/createCMS-logo-dark.svg"
            alt="createCMS"
            className="hidden h-6 w-auto dark:block"
          />
        </>
      ),
    },
  };
}
