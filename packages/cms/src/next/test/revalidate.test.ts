import { revalidatePath, revalidateTag } from 'next/cache';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRevalidateHandler } from '../index';

// The handler fans out via a runtime `await import('next/cache')`; mock it so we
// can assert the fan-out without a live Next runtime (revalidate* throw off a
// request). Hoisted by vitest above the imports.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const SECRET = 's3cret';

function makeRequest(
  body: string,
  headers: Record<string, string> = {
    'x-revalidate-secret': SECRET,
    'content-type': 'application/json',
  },
): Request {
  return new Request('http://x/revalidate', { method: 'POST', headers, body });
}

describe('createRevalidateHandler', () => {
  const POST = createRevalidateHandler({ secret: SECRET });

  beforeEach(() => {
    vi.mocked(revalidatePath).mockClear();
    vi.mocked(revalidateTag).mockClear();
  });

  it('rejects a request with no secret header (401)', async () => {
    const res = await POST(
      makeRequest(JSON.stringify({ paths: ['/a'] }), {
        'content-type': 'application/json',
      }),
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ message: 'Unauthorized' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a request with a wrong secret header (401)', async () => {
    const res = await POST(
      makeRequest(JSON.stringify({ paths: ['/a'] }), {
        'x-revalidate-secret': 'nope',
        'content-type': 'application/json',
      }),
    );
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ message: 'Unauthorized' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('rejects a malformed JSON body (400)', async () => {
    const res = await POST(makeRequest('{ not json'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ message: 'Invalid JSON body' });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('returns 200 with empty paths/tags and does not fan out', async () => {
    const res = await POST(
      makeRequest(JSON.stringify({ paths: [], tags: [] })),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      revalidated: true,
      paths: [],
      tags: [],
    });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it('fans out revalidatePath per path and revalidateTag per tag', async () => {
    const res = await POST(
      makeRequest(
        JSON.stringify({ paths: ['/a', '/b'], tags: ['t1', 't2', 't3'] }),
      ),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      revalidated: true,
      paths: ['/a', '/b'],
      tags: ['t1', 't2', 't3'],
    });

    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith('/a');
    expect(revalidatePath).toHaveBeenCalledWith('/b');

    expect(revalidateTag).toHaveBeenCalledTimes(3);
    // next 16 requires the second `profile` arg; 'max' = legacy immediate purge.
    expect(revalidateTag).toHaveBeenCalledWith('t1', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('t2', 'max');
    expect(revalidateTag).toHaveBeenCalledWith('t3', 'max');
  });
});
