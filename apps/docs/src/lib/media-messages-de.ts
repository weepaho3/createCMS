import type { MediaFormatters, MediaMessages } from '@createcms/react/media';

// Typed as the full catalog, so a key added to `MediaMessages` fails the
// type check until it is translated here.

function plural(
  count: number,
  format: MediaFormatters,
  one: string,
  other: string,
): string {
  return format.plural(count) === 'one' ? one : other;
}

export const mediaMessagesDe: MediaMessages = {
  folder: {
    path: 'Ordnerpfad',
    root: 'Mediathek',
    create: 'Neuer Ordner',
    createTitle: 'Ordner anlegen',
    createDescription: 'Der Ordner wird im aktuellen Ordner angelegt.',
    name: 'Ordnername',
    deleteConfirm: ({ name, folders, assets, inUse, pages }, format) => {
      const parts = [
        `"${name}" löschen?`,
        `Er enthält ${format.number(folders)} ${plural(folders, format, 'Ordner', 'Ordner')} und ${format.number(assets)} ${plural(assets, format, 'Datei', 'Dateien')}.`,
      ];
      if (inUse > 0) {
        parts.push(
          `${format.number(inUse)} ${plural(inUse, format, 'Datei wird', 'Dateien werden')} auf ${format.number(pages)} ${plural(pages, format, 'Seite', 'Seiten')} verwendet.`,
        );
      }
      return parts.join(' ');
    },
  },
  search: { label: 'Medien durchsuchen' },
  sort: {
    label: 'Sortierung',
    newest: 'Neueste zuerst',
    oldest: 'Älteste zuerst',
    nameAsc: 'Name (A-Z)',
    nameDesc: 'Name (Z-A)',
    sizeAsc: 'Kleinste zuerst',
    sizeDesc: 'Größte zuerst',
  },
  action: {
    create: 'Anlegen',
    cancel: 'Abbrechen',
    retry: 'Erneut versuchen',
    dismiss: 'Schließen',
    loadMore: 'Mehr laden',
    clearSelection: 'Auswahl aufheben',
    move: 'In Ordner verschieben',
    moveTitle: 'Dateien verschieben',
    moveDescription: 'Wähle ein Ziel für die ausgewählten Dateien.',
    makePublic: 'Öffentlich machen',
    makePrivate: 'Privat machen',
    archive: 'Archivieren',
    archiveTitle: 'Dateien archivieren?',
    archiveDescription:
      'Archivierte Dateien werden nicht mehr ausgeliefert. Dateien, die in Inhalten verwendet werden, bleiben unverändert.',
  },
  visibility: {
    private: 'Privat',
    public: 'Öffentlich',
    hint: 'Die Sichtbarkeit steuert die Auslieferung über den Asset-Endpunkt. Sie ist keine Zugriffsgrenze: Die Dateien bleiben im Speicher erreichbar.',
  },
  dropzone: {
    idle: 'Dateien hierher ziehen oder klicken zum Hochladen',
    active: 'Loslassen zum Hochladen',
    uploading: 'Wird hochgeladen…',
  },
  list: {
    empty: 'Keine Dateien in diesem Ordner.',
    loadError: 'Dateien konnten nicht geladen werden.',
    mutationError: 'Die letzte Änderung ist fehlgeschlagen.',
  },
  selection: {
    count: ({ count }, format) => `${format.number(count)} ausgewählt`,
  },
  bulk: {
    skipped: ({ count }, format) =>
      plural(
        count,
        format,
        `${format.number(count)} Datei wurde übersprungen, weil sie verwendet wird`,
        `${format.number(count)} Dateien wurden übersprungen, weil sie verwendet werden`,
      ),
  },
  type: {
    image: 'Bild',
    video: 'Video',
    audio: 'Audio',
    document: 'Dokument',
    other: 'Datei',
  },
  upload: {
    title: 'Uploads',
    all: 'Alle Uploads',
    abort: 'Uploads abbrechen',
    clear: 'Abgeschlossene entfernen',
    status: {
      queued: 'Wartet',
      preparing: 'Wird vorbereitet',
      signing: 'Wird vorbereitet',
      uploading: 'Wird hochgeladen',
      completing: 'Wird verarbeitet',
      retrying: 'Neuer Versuch',
      paused: 'Pausiert',
      success: 'Hochgeladen',
      error: 'Fehlgeschlagen',
      aborted: 'Abgebrochen',
    },
    progress: ({ done, total, percent }, format) =>
      `${format.number(done)} von ${format.number(total)} ${plural(total, format, 'Datei', 'Dateien')} (${format.percent(percent / 100)})`,
    eta: ({ seconds }, format) => format.eta(seconds),
    failed: ({ reason }) => `Fehlgeschlagen: ${reason}`,
  },
  image: {
    provenance: { ai_generated: 'KI-generiert', ai_edited: 'KI-bearbeitet' },
  },
  picker: {
    title: 'Datei auswählen',
    choose: 'Auswählen',
    select: 'Übernehmen',
    disabled: {
      dimensions: ({ minWidth, minHeight }, format) =>
        `Mindestens ${format.number(minWidth)} × ${format.number(minHeight)} px nötig`,
    },
  },
  usage: {
    hiddenRoots: ({ count }, format) =>
      plural(
        count,
        format,
        `${format.number(count)} weitere Seite ohne Zugriff`,
        `${format.number(count)} weitere Seiten ohne Zugriff`,
      ),
  },
  shortcut: ({ key }, format) => (format.apple ? `⌘${key}` : `Strg+${key}`),
  error: {
    unknown: 'Etwas ist schiefgelaufen.',
    size: ({ max }, format) => `Die Datei ist größer als ${format.bytes(max)}.`,
    type: ({ accepted }) => `Erlaubt sind nur diese Dateitypen: ${accepted}.`,
    ASSET_ACCESS_DENIED: 'Diese Datei ist nicht verfügbar.',
    ASSET_NOT_FOUND: 'Die Datei existiert nicht mehr.',
    CANNOT_MOVE_INTO_DESCENDANT:
      'Ein Ordner kann nicht in einen eigenen Unterordner verschoben werden.',
    CANNOT_MOVE_INTO_SELF:
      'Ein Ordner kann nicht in sich selbst verschoben werden.',
    CANNOT_REPLACE_VARIANT: 'Eine erzeugte Variante kann nicht ersetzt werden.',
    FILE_TOO_LARGE: 'Die Datei ist zu groß.',
    FOLDER_HAS_CONTENT: 'Der Ordner ist nicht leer.',
    FOLDER_NOT_FOUND: 'Der Ordner existiert nicht mehr.',
    INVALID_FILE_TYPE: 'Dieser Dateityp ist nicht erlaubt.',
    NETWORK_ERROR: 'Die Verbindung wurde unterbrochen.',
    PARENT_NOT_FOUND: 'Der Zielordner existiert nicht mehr.',
    SLUG_GENERATION_FAILED: 'Es wurde kein freier Dateiname gefunden.',
    STORAGE_UNSUPPORTED: 'Der Speicher unterstützt diesen Upload nicht.',
    TOO_MANY_FILES: 'Zu viele Dateien auf einmal.',
    UPLOAD_EXPIRED: 'Der Upload-Link ist abgelaufen.',
    UPLOAD_FAILED: 'Der Upload ist fehlgeschlagen.',
    UPLOAD_NOT_FOUND:
      'Die hochgeladene Datei wurde im Speicher nicht gefunden.',
    UPLOAD_TOKEN_INVALID: 'Der Upload konnte nicht bestätigt werden.',
  },
};
