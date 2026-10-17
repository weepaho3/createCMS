import { describe, expect, it } from 'vitest';

import { provenanceFromDigitalSourceType, readProvenance } from '../provenance';

const IPTC = 'http://cv.iptc.org/newscodes/digitalsourcetype/';
const encode = (text: string) => new TextEncoder().encode(text);

/** A JPEG head with an XMP packet holding `xmpBody`. */
function jpegWithXmp(xmpBody: string): Uint8Array {
  return encode(
    `\xff\xd8\xff\xe1..http://ns.adobe.com/xap/1.0/\0<x:xmpmeta><rdf:RDF><rdf:Description ${xmpBody}/></rdf:RDF></x:xmpmeta>`,
  );
}

/** A minimal C2PA JUMBF region with a claim generator and an action. */
function c2paManifest(generator: string, sourceType?: string): Uint8Array {
  const head = String.fromCharCode(0x60 + generator.length);
  return encode(
    `....jumb....jumdc2pa....claim_generator${head}${generator}` +
      (sourceType ? `c2pa.actions digitalSourceType ${IPTC}${sourceType}` : ''),
  );
}

describe('provenanceFromDigitalSourceType', () => {
  it.each([
    ['trainedAlgorithmicMedia', 'ai_generated'],
    ['algorithmicMedia', 'ai_generated'],
    ['compositeWithTrainedAlgorithmicMedia', 'ai_edited'],
    ['compositeSynthetic', 'ai_edited'],
    ['digitalCapture', 'captured'],
    ['computationalCapture', 'captured'],
    ['negativeFilm', 'captured'],
    ['positiveFilm', 'captured'],
    ['print', 'captured'],
    ['compositeCapture', 'captured'],
    ['virtualRecording', 'unknown'],
    ['', 'unknown'],
  ])('maps %s to %s', (term, expected) => {
    expect(provenanceFromDigitalSourceType(`${IPTC}${term}`)).toBe(expected);
  });

  it('accepts a bare term and nothing', () => {
    expect(provenanceFromDigitalSourceType('digitalCapture')).toBe('captured');
    expect(provenanceFromDigitalSourceType(undefined)).toBe('unknown');
  });
});

describe('readProvenance', () => {
  it('reads the XMP attribute form', () => {
    const reading = readProvenance(
      jpegWithXmp(
        `Iptc4xmpExt:DigitalSourceType="${IPTC}trainedAlgorithmicMedia"`,
      ),
    );
    expect(reading).toEqual({
      provenance: 'ai_generated',
      metadata: {
        iptcDigitalSourceType: `${IPTC}trainedAlgorithmicMedia`,
        provenanceSource: 'iptc',
      },
    });
  });

  it('reads the XMP resource form', () => {
    const reading = readProvenance(
      encode(
        `<Iptc4xmpExt:DigitalSourceType rdf:resource="${IPTC}digitalCapture"/>`,
      ),
    );
    expect(reading.provenance).toBe('captured');
  });

  it('raises a C2PA AI action to at least ai_edited', () => {
    const reading = readProvenance(
      c2paManifest('Adobe Firefly', 'compositeWithTrainedAlgorithmicMedia'),
    );
    expect(reading).toEqual({
      provenance: 'ai_edited',
      metadata: {
        c2pa: {
          present: true,
          claimGenerator: 'Adobe Firefly',
          aiActions: ['compositeWithTrainedAlgorithmicMedia'],
        },
        provenanceSource: 'c2pa',
      },
    });
  });

  it('keeps ai_generated from IPTC when a manifest is present too', () => {
    const bytes = new Uint8Array([
      ...jpegWithXmp(`Iptc4xmpExt:DigitalSourceType="${IPTC}algorithmicMedia"`),
      ...c2paManifest('gen', 'trainedAlgorithmicMedia'),
    ]);
    const reading = readProvenance(bytes);
    expect(reading.provenance).toBe('ai_generated');
    expect(reading.metadata.provenanceSource).toBe('iptc');
    expect(reading.metadata.c2pa?.present).toBe(true);
  });

  it('notes a manifest without AI actions', () => {
    const reading = readProvenance(c2paManifest('Camera 1.0'));
    expect(reading).toEqual({
      provenance: 'unknown',
      metadata: { c2pa: { present: true, claimGenerator: 'Camera 1.0' } },
    });
  });

  it('reports nothing for plain bytes', () => {
    expect(readProvenance(encode('\x89PNG\r\n\x1a\n'))).toEqual({
      provenance: 'unknown',
      metadata: {},
    });
  });
});
