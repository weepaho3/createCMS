import type { AssetMetadata, AssetProvenance } from '../types/asset-metadata';

/**
 * Leading bytes searched for provenance markers. XMP and a C2PA manifest sit
 * near the start of JPEG, PNG and WebP files written by common tools.
 */
export const PROVENANCE_SCAN_BYTES = 256 * 1024;

/**
 * IPTC Digital Source Type terms (the last segment of the
 * `http://cv.iptc.org/newscodes/digitalsourcetype/` URI) and the provenance
 * each one means.
 */
const DIGITAL_SOURCE_TYPES: Readonly<Record<string, AssetProvenance>> = {
  trainedAlgorithmicMedia: 'ai_generated',
  algorithmicMedia: 'ai_generated',
  compositeWithTrainedAlgorithmicMedia: 'ai_edited',
  compositeSynthetic: 'ai_edited',
  digitalCapture: 'captured',
  computationalCapture: 'captured',
  negativeFilm: 'captured',
  positiveFilm: 'captured',
  print: 'captured',
  compositeCapture: 'captured',
};

/** Terms that mark an AI step when they appear in a C2PA manifest's actions. */
const AI_TERMS = [
  'trainedAlgorithmicMedia',
  'compositeWithTrainedAlgorithmicMedia',
  'algorithmicMedia',
  'compositeSynthetic',
];

const RANK: Readonly<Record<AssetProvenance, number>> = {
  unknown: 0,
  captured: 1,
  ai_edited: 2,
  ai_generated: 3,
};

/** The provenance an IPTC Digital Source Type URI or term stands for. */
export function provenanceFromDigitalSourceType(
  value: string | null | undefined,
): AssetProvenance {
  if (!value) return 'unknown';
  const term = value.trim().split('/').pop() ?? '';
  return DIGITAL_SOURCE_TYPES[term] ?? 'unknown';
}

export type ProvenanceReading = {
  provenance: AssetProvenance;
  /** `metadata` fields the reading supports: the raw IPTC URI, C2PA facts and their source. */
  metadata: Pick<
    AssetMetadata,
    'iptcDigitalSourceType' | 'c2pa' | 'provenanceSource'
  >;
};

function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return out;
}

/**
 * The CBOR text string that follows the map key `key` in `text` (a latin1
 * view of the bytes), or `undefined` when the next item is not a text string.
 */
function cborTextAfter(text: string, key: string): string | undefined {
  const at = text.indexOf(key);
  if (at === -1) return undefined;
  let offset = at + key.length;
  const head = text.charCodeAt(offset++);
  if (head >> 5 !== 3) return undefined;
  let length = head & 0x1f;
  if (length === 24) {
    length = text.charCodeAt(offset++);
  } else if (length === 25) {
    length = (text.charCodeAt(offset) << 8) | text.charCodeAt(offset + 1);
    offset += 2;
  } else if (length > 24) {
    return undefined;
  }
  const value = text.slice(offset, offset + length);
  return value.length === length ? value : undefined;
}

const XMP_SOURCE_TYPE = [
  /Iptc4xmpExt:DigitalSourceType\s*=\s*"([^"]+)"/,
  /<Iptc4xmpExt:DigitalSourceType[^>]*rdf:resource\s*=\s*"([^"]+)"/,
  /<Iptc4xmpExt:DigitalSourceType>\s*([^<\s]+)\s*</,
];

/**
 * Provenance from the leading bytes of a file, without decoding it: the XMP
 * `Iptc4xmpExt:DigitalSourceType` property and the presence of a C2PA
 * manifest (a JUMBF `jumb` box labelled `c2pa`). The manifest's signature is
 * not verified; an AI action in it raises the result to at least
 * `ai_edited`. No DOM or Node APIs.
 */
export function readProvenance(bytes: Uint8Array): ProvenanceReading {
  const text = latin1(bytes.subarray(0, PROVENANCE_SCAN_BYTES));
  const metadata: ProvenanceReading['metadata'] = {};

  let iptcUri: string | undefined;
  for (const pattern of XMP_SOURCE_TYPE) {
    const match = pattern.exec(text);
    if (match) {
      iptcUri = match[1];
      break;
    }
  }
  let provenance = provenanceFromDigitalSourceType(iptcUri);
  if (iptcUri) {
    metadata.iptcDigitalSourceType = iptcUri;
    metadata.provenanceSource = 'iptc';
  }

  const jumbf = text.indexOf('jumb');
  if (jumbf !== -1 && text.indexOf('c2pa', jumbf) !== -1) {
    const manifest = text.slice(jumbf);
    const aiActions = AI_TERMS.filter((term) =>
      new RegExp(`digitalsourcetype/${term}\\b`).test(manifest),
    );
    const generator = cborTextAfter(manifest, 'claim_generator');
    metadata.c2pa = { present: true };
    if (generator) metadata.c2pa.claimGenerator = generator.trim();
    if (aiActions.length > 0) {
      metadata.c2pa.aiActions = aiActions;
      if (RANK[provenance] < RANK.ai_edited) {
        provenance = 'ai_edited';
        metadata.provenanceSource = 'c2pa';
      }
    }
  }

  return { provenance, metadata };
}
