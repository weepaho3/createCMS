import { describe, expect, it } from 'vitest';

import type { MediaConfig } from '../../types/s3';

import {
  deriveUploadKey,
  mintUploadToken,
  scopeFingerprint,
  UPLOAD_TOKEN_GRACE_MS,
  type UploadTokenPayload,
  isTokenBoundTo,
  verifyUploadToken,
} from '../upload-token';

const baseConfig = (): MediaConfig => ({
  provider: 'custom',
  hostname: 'localhost',
  region: 'us-east-1',
  accessKeyId: 'key',
  secretAccessKey: 'secret',
  bucketName: 'bucket',
  publicUrl: 'http://localhost/bucket',
});

const payload: UploadTokenPayload = {
  kind: 'upload',
  aud: 'completeUpload',
  host: 'cms.example.com',
  id: 'ast_1',
  name: 'photo.jpg',
  objectKey: 'ast_1/photo.jpg',
  type: 'image/jpeg',
  size: 1024,
  folderId: null,
  variantOf: null,
  actor: 'usr_1',
  scope: 'abc',
  exp: 1_000_000,
};

function tamper(token: string, part: 0 | 1): string {
  const parts = token.split('.');
  const chars = parts[part].split('');
  chars[0] = chars[0] === 'A' ? 'B' : 'A';
  parts[part] = chars.join('');
  return parts.join('.');
}

describe('upload token', () => {
  it('round-trips a payload', async () => {
    const key = await deriveUploadKey(baseConfig());
    const token = await mintUploadToken(key, payload);
    expect(await verifyUploadToken(key, token, payload.exp)).toEqual(payload);
  });

  it('rejects a tampered payload', async () => {
    const key = await deriveUploadKey(baseConfig());
    const token = await mintUploadToken(key, payload);
    expect(await verifyUploadToken(key, tamper(token, 0), payload.exp)).toBe(
      null,
    );
  });

  it('rejects a tampered signature', async () => {
    const key = await deriveUploadKey(baseConfig());
    const token = await mintUploadToken(key, payload);
    expect(await verifyUploadToken(key, tamper(token, 1), payload.exp)).toBe(
      null,
    );
    expect(await verifyUploadToken(key, 'nodot', payload.exp)).toBe(null);
    expect(await verifyUploadToken(key, `${token}.`, payload.exp)).toBe(null);
  });

  it('rejects a token minted with another secret', async () => {
    const key = await deriveUploadKey(baseConfig());
    const other = await deriveUploadKey({
      ...baseConfig(),
      secretAccessKey: 'different',
    });
    const token = await mintUploadToken(other, payload);
    expect(await verifyUploadToken(key, token, payload.exp)).toBe(null);
  });

  it('rejects a token past the grace window and accepts one inside it', async () => {
    const key = await deriveUploadKey(baseConfig());
    const token = await mintUploadToken(key, payload);
    expect(
      await verifyUploadToken(
        key,
        token,
        payload.exp + UPLOAD_TOKEN_GRACE_MS + 1,
      ),
    ).toBe(null);
    expect(
      await verifyUploadToken(key, token, payload.exp + UPLOAD_TOKEN_GRACE_MS),
    ).toEqual(payload);
  });

  it('signs differently with uploadSecret than with the derived key', async () => {
    const derived = await deriveUploadKey(baseConfig());
    const explicit = await deriveUploadKey({
      ...baseConfig(),
      uploadSecret: 'secret',
    });
    const a = await mintUploadToken(derived, payload);
    const b = await mintUploadToken(explicit, payload);
    expect(a.split('.')[0]).toBe(b.split('.')[0]);
    expect(a.split('.')[1]).not.toBe(b.split('.')[1]);
  });

  it('caches the derived key per config object', async () => {
    const config = baseConfig();
    expect(await deriveUploadKey(config)).toBe(await deriveUploadKey(config));
  });

  it('fingerprints insert columns independent of key order', async () => {
    const a = await scopeFingerprint({ tenant_slug: 'acme', language: 'en' });
    const b = await scopeFingerprint({ language: 'en', tenant_slug: 'acme' });
    const c = await scopeFingerprint({ tenant_slug: 'globex', language: 'en' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(await scopeFingerprint(undefined)).toBe(await scopeFingerprint({}));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('isTokenBoundTo', () => {
  it('redeems only at its endpoint and on its host', () => {
    expect(isTokenBoundTo(payload, 'completeUpload', 'cms.example.com')).toBe(
      true,
    );
    expect(
      isTokenBoundTo(
        payload,
        ['commitRendition', 'completeUpload'],
        'cms.example.com',
      ),
    ).toBe(true);
    expect(isTokenBoundTo(payload, 'commitReplace', 'cms.example.com')).toBe(
      false,
    );
    expect(isTokenBoundTo(payload, 'completeUpload', 'other.example.com')).toBe(
      false,
    );
    expect(isTokenBoundTo(payload, 'completeUpload', null)).toBe(false);
  });

  it('rejects tokens minted without a binding', async () => {
    const key = await deriveUploadKey(baseConfig());
    const { aud: _aud, host: _host, ...unbound } = payload;
    const token = await mintUploadToken(key, unbound as UploadTokenPayload);
    expect(await verifyUploadToken(key, token, payload.exp)).toBe(null);
  });
});
