import { notFound } from 'next/navigation';

import { COPY } from '@/lib/launch-copy';
import { generateBrandOgImage } from '@/lib/og-image';
import { getPageImage, source } from '@/lib/source';

export const revalidate = false;

export async function GET(
  _req: Request,
  { params }: RouteContext<'/og/docs/[...slug]'>,
) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return generateBrandOgImage({
    title: page.data.title,
    description: COPY.primary,
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }));
}
