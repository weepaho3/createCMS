import { describe, expect, it } from 'vitest';

import { createCustomClient } from '../client';
import { signGetObject } from '../utils';

const client = () =>
  createCustomClient({
    provider: 'custom',
    hostname: 'localhost:9000',
    region: 'us-east-1',
    accessKeyId: 'key',
    secretAccessKey: 'secret',
    bucketName: 'bucket',
    publicUrl: 'http://localhost:9000/bucket',
    secure: false,
    forcePathStyle: true,
  });

describe('signGetObject', () => {
  it('binds the response disposition and expiry into the signed URL', async () => {
    const signed = new URL(
      await signGetObject(client(), {
        bucket: 'bucket',
        key: 'docs/report.pdf',
        expiresIn: 3600,
        responseContentDisposition: 'attachment;filename="report.pdf"',
      }),
    );

    expect(signed.pathname).toBe('/bucket/docs/report.pdf');
    expect(signed.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(signed.searchParams.get('response-content-disposition')).toBe(
      'attachment;filename="report.pdf"',
    );
    expect(signed.searchParams.get('X-Amz-Signature')).toMatch(
      /^[0-9a-f]{64}$/,
    );
    expect(signed.searchParams.get('X-Amz-SignedHeaders')).toBe('host');
  });

  it('encodes spaces as %20 so the signed query matches the canonical form', async () => {
    const signed = await signGetObject(client(), {
      bucket: 'bucket',
      key: 'a.bin',
      expiresIn: 3600,
      responseContentDisposition: 'attachment;filename="my file.p df"',
    });

    expect(signed).not.toContain('+');
    expect(signed).toContain('my%20file.p%20df');
    expect(
      new URL(signed).searchParams.get('response-content-disposition'),
    ).toBe('attachment;filename="my file.p df"');
  });

  it('changes the signature when the disposition changes', async () => {
    const base = { bucket: 'bucket', key: 'a.bin', expiresIn: 3600 };
    const [a, b, c] = await Promise.all([
      signGetObject(client(), {
        ...base,
        responseContentDisposition: 'attachment;filename="a.bin"',
      }),
      signGetObject(client(), {
        ...base,
        responseContentDisposition: 'attachment;filename="b.bin"',
      }),
      signGetObject(client(), base),
    ]);
    const sig = (u: string) => new URL(u).searchParams.get('X-Amz-Signature');

    expect(sig(a)).not.toBe(sig(b));
    expect(sig(a)).not.toBe(sig(c));
    expect(new URL(c).searchParams.has('response-content-disposition')).toBe(
      false,
    );
  });
});
