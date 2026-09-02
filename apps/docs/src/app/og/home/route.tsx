import { COPY } from '@/lib/launch-copy';
import { generateBrandOgImage } from '@/lib/og-image';

export const revalidate = false;

export function GET() {
  return generateBrandOgImage({
    title: COPY.primary,
    description: COPY.subhead,
  });
}
