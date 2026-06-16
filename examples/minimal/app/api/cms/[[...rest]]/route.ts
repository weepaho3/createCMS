import { cms } from '@/lib/cms';

/**
 * Mounts the CMS HTTP router on a Next.js catch-all route. The CMS serves
 * every endpoint under `basePath` (default `/api/cms`).
 */
const { handler } = cms.router;

export const GET = handler;
export const POST = handler;
