import { cleanup, render } from '@testing-library/react';
// @vitest-environment happy-dom
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MediaMessagesInput } from './messages';

import { MediaSearch } from './collection';
import { MediaBreadcrumbs, MediaCrumb } from './folders';
import {
  createMediaFormatters,
  defaultMediaMessages,
  mediaErrorMessage,
  mergeMediaMessages,
} from './messages';
import { MediaRoot } from './root';
import { makeClient, makeEntry, makeUploadState } from './test-fixtures';
import {
  MediaUploadItem,
  MediaUploadList,
  MediaUploadProgress,
} from './uploads';

afterEach(cleanup);

const de: MediaMessagesInput = {
  folder: { path: 'Ordnerpfad', root: 'Mediathek' },
  search: { label: 'Medien durchsuchen' },
  upload: {
    all: 'Alle Uploads',
    status: { aborted: 'Abgebrochen' },
    failed: ({ reason }) => `Fehlgeschlagen: ${reason}`,
  },
  error: { UPLOAD_EXPIRED: 'Der Upload-Link ist abgelaufen.' },
  selection: {
    count: ({ count }, format) =>
      format.plural(count) === 'one'
        ? `${format.number(count)} Datei ausgewählt`
        : `${format.number(count)} Dateien ausgewählt`,
  },
};

describe('mergeMediaMessages', () => {
  it('returns the defaults without input', () => {
    expect(mergeMediaMessages()).toBe(defaultMediaMessages);
  });

  it('merges key by key and keeps untouched defaults', () => {
    const merged = mergeMediaMessages(de);
    expect(merged.folder.root).toBe('Mediathek');
    expect(merged.folder.name).toBe(defaultMediaMessages.folder.name);
    expect(merged.upload.status.aborted).toBe('Abgebrochen');
    expect(merged.upload.status.success).toBe('Uploaded');
    expect(merged.error.UPLOAD_EXPIRED).toBe('Der Upload-Link ist abgelaufen.');
    expect(merged.error.FILE_TOO_LARGE).toBe(
      defaultMediaMessages.error.FILE_TOO_LARGE,
    );
  });
});

describe('mediaErrorMessage', () => {
  it('maps known codes and falls back for unknown ones', () => {
    expect(mediaErrorMessage(defaultMediaMessages, 'UPLOAD_EXPIRED')).toBe(
      'The upload link expired.',
    );
    expect(mediaErrorMessage(defaultMediaMessages, 'SOMETHING_NEW')).toBe(
      'Something went wrong.',
    );
    expect(mediaErrorMessage(defaultMediaMessages, 'size')).toBe(
      'Something went wrong.',
    );
    expect(mediaErrorMessage(defaultMediaMessages, undefined)).toBe(
      'Something went wrong.',
    );
  });
});

describe('formatters', () => {
  it('picks the byte unit by magnitude and follows the locale', () => {
    const en = createMediaFormatters('en-US');
    expect(en.bytes(512)).toBe('512 byte');
    expect(en.bytes(1536)).toBe('1.5 kB');
    expect(en.bytes(5 * 1024 * 1024)).toBe('5 MB');
    const deFmt = createMediaFormatters('de-DE');
    expect(deFmt.bytes(1536)).toBe('1,5 kB');
    expect(deFmt.number(12345)).toBe('12.345');
  });

  it('formats percentages and remaining time', () => {
    const en = createMediaFormatters('en-US');
    expect(en.percent(0.456)).toBe('46%');
    expect(en.eta(30)).toBe('in 30 seconds');
    expect(en.eta(120)).toBe('in 2 minutes');
  });

  it('selects plural categories per locale', () => {
    const merged = mergeMediaMessages(de);
    const deFmt = createMediaFormatters('de-DE');
    expect(merged.selection.count({ count: 1 }, deFmt)).toBe(
      '1 Datei ausgewählt',
    );
    expect(merged.selection.count({ count: 3 }, deFmt)).toBe(
      '3 Dateien ausgewählt',
    );
    const en = createMediaFormatters('en-US');
    expect(defaultMediaMessages.bulk.skipped({ count: 1 }, en)).toBe(
      '1 asset was skipped because it is in use',
    );
    expect(defaultMediaMessages.bulk.skipped({ count: 2 }, en)).toBe(
      '2 assets were skipped because they are in use',
    );
  });

  it('labels shortcuts with the platform modifier', () => {
    const format = createMediaFormatters('en-US');
    expect(
      defaultMediaMessages.shortcut({ key: 'A' }, { ...format, apple: true }),
    ).toBe('⌘A');
    expect(
      defaultMediaMessages.shortcut({ key: 'A' }, { ...format, apple: false }),
    ).toBe('Ctrl+A');
  });
});

describe('Media.Root messages', () => {
  it('renders the parts with a translated catalog', () => {
    const client = makeClient({
      useUploadAssets: vi.fn(() =>
        makeUploadState({
          files: [
            makeEntry({
              id: 'e',
              name: 'e.png',
              status: 'error',
              error: {
                code: 'UPLOAD_EXPIRED',
                message: 'server text',
                retryable: false,
              },
            }),
          ],
        }),
      ),
    });
    const { getByRole, getAllByRole } = render(
      <MediaRoot client={client} messages={de} locale="de-DE">
        <MediaBreadcrumbs>
          {() => <MediaCrumb folder={null} />}
        </MediaBreadcrumbs>
        <MediaSearch />
        <MediaUploadProgress />
        <MediaUploadList>
          {(entry) => (
            <MediaUploadItem key={entry.id} entry={entry}>
              <MediaUploadProgress />
            </MediaUploadItem>
          )}
        </MediaUploadList>
      </MediaRoot>,
    );

    expect(getByRole('navigation').getAttribute('aria-label')).toBe(
      'Ordnerpfad',
    );
    expect(getByRole('button').textContent).toBe('Mediathek');
    expect(getByRole('searchbox').getAttribute('aria-label')).toBe(
      'Medien durchsuchen',
    );
    const [all, entry] = getAllByRole('progressbar');
    expect(all.getAttribute('aria-label')).toBe('Alle Uploads');
    expect(entry.getAttribute('aria-valuetext')).toBe(
      'Fehlgeschlagen: Der Upload-Link ist abgelaufen.',
    );
  });
});
