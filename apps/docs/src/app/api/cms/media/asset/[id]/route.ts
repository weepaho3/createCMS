import { notFound, redirect } from 'next/navigation';

import { DEMO_ASSETS } from '@/app/demo/_lib/assets';

export async function GET(
  _req: Request,
  { params }: RouteContext<'/api/cms/media/asset/[id]'>,
) {
  const { id } = await params;
  const asset = DEMO_ASSETS.find((item) => item.id === id);
  if (!asset) notFound();
  redirect(asset.url);
}
