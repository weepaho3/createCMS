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
    tree: 'Ordner',
    defaultName: 'Neuer Ordner',
    rename: 'Umbenennen',
    delete: 'Ordner löschen',
    deleteTitle: 'Ordner löschen?',
    deleteMode: {
      moveToParent: 'Inhalt in den übergeordneten Ordner verschieben',
      archiveContents: 'Inhalt archivieren',
    },
    typeToConfirm: ({ name }) => `Zum Bestätigen "${name}" eingeben`,
    created: ({ name }) => `Ordner angelegt: ${name}`,
    renamed: ({ name }) => `Ordner umbenannt: ${name}`,
    deleted: ({ name }) => `Ordner gelöscht: ${name}`,
    overflow: 'Weitere Ordner zeigen',
    count: ({ count }, format) =>
      `${format.number(count)} ${plural(count, format, 'Datei', 'Dateien')}`,
  },
  grid: {
    label: 'Medien',
    describe: ({ type, width, height, size }, format) =>
      [
        type,
        width && height
          ? `${format.number(width)} mal ${format.number(height)} Pixel`
          : null,
        format.bytes(size),
      ]
        .filter(Boolean)
        .join(', '),
    uploading: ({ name, percent }, format) =>
      `${name}, wird hochgeladen ${format.percent(percent / 100)}`,
    loadingMore: 'Weitere Medien werden geladen…',
    loadedMore: ({ count, loaded, total }, format) =>
      total === null
        ? `${format.number(count)} weitere Medien geladen`
        : `${format.number(count)} weitere Medien geladen, ${format.number(loaded)} von ${format.number(total)}`,
  },
  empty: {
    'folder-empty': 'Dieser Ordner ist leer.',
    'no-results': 'Keine Medien passen zu den Filtern.',
    error: 'Medien konnten nicht geladen werden.',
    'no-permission': 'Du hast keinen Zugriff auf diese Medien.',
  },
  filter: {
    label: 'Filter',
    clear: 'Filter zurücksetzen',
    remove: ({ label }) => `Filter ${label} entfernen`,
    kind: {
      image: 'Bilder',
      video: 'Videos',
      audio: 'Audio',
      document: 'Dokumente',
      archive: 'Archive',
      other: 'Andere Dateien',
    },
    provenance: {
      unknown: 'Herkunft unbekannt',
      captured: 'Aufgenommen',
      ai_generated: 'KI-generiert',
      ai_edited: 'KI-bearbeitet',
    },
    usage: { used: 'Verwendet', unused: 'Unbenutzt' },
    missingAlt: 'Ohne Alt-Text',
    searchIn: ({ folder }) => `Suche in ${folder}`,
    allFolders: 'Alle Ordner',
    chip: ({ label, count }, format) =>
      count === null ? label : `${label} (${format.number(count)})`,
  },
  intake: {
    overlay: 'Dateien zum Hochladen ablegen',
    files: 'Dateien hochladen',
    folder: 'Ordner hochladen',
    paste: 'Aus Zwischenablage einfügen',
    reading: ({ count }, format) =>
      `Ordner wird gelesen… ${format.number(count)} ${plural(count, format, 'Datei', 'Dateien')}`,
    recreate: ({ folders, files }, format) =>
      `Ordnerstruktur nachbilden (${format.number(folders)} Ordner, ${format.number(files)} ${plural(files, format, 'Datei', 'Dateien')})`,
    flatten: 'Alles in den aktuellen Ordner',
    skippedSystem: ({ count }, format) =>
      `${format.number(count)} ${plural(count, format, 'Systemdatei wurde', 'Systemdateien wurden')} übersprungen`,
    rejected: ({ count }, format) =>
      `${format.number(count)} ${plural(count, format, 'Datei wurde', 'Dateien wurden')} abgelehnt`,
    truncated: ({ count }, format) =>
      `Nur die ersten ${format.number(count)} Dateien wurden gelesen`,
  },
  move: {
    title: 'Verschieben nach',
    description: 'Wähle den Zielordner.',
    confirm: 'Hierher verschieben',
    dragCount: ({ count }, format) =>
      `${format.number(count)} ${plural(count, format, 'Element', 'Elemente')}`,
    insert: 'In Editor einfügen',
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
    all: ({ count }, format) => `Alle ${format.number(count)} ausgewählt`,
    cleared: 'Auswahl aufgehoben',
    selectAllMatching: ({ count }, format) =>
      `Alle ${format.number(count)} auswählen`,
    hidden: ({ count }, format) =>
      plural(
        count,
        format,
        `${format.number(count)} ausgewähltes Element ist durch Filter verborgen`,
        `${format.number(count)} ausgewählte Elemente sind durch Filter verborgen`,
      ),
    item: ({ name }) => `${name} auswählen`,
  },
  bulk: {
    skipped: ({ count }, format) =>
      plural(
        count,
        format,
        `${format.number(count)} Datei wurde übersprungen, weil sie verwendet wird`,
        `${format.number(count)} Dateien wurden übersprungen, weil sie verwendet werden`,
      ),
    bar: 'Aktionen für die Auswahl',
    action: {
      move: 'Verschieben nach…',
      makePublic: 'Öffentlich machen',
      makePrivate: 'Privat machen',
      setProvenance: 'Herkunft setzen',
      download: 'Herunterladen',
      archive: 'Archivieren',
      restore: 'Wiederherstellen',
      purge: 'Endgültig löschen',
    },
    disabled: {
      empty: 'Zuerst Dateien auswählen.',
      unsupported: 'Auf diesem Server nicht verfügbar.',
      archived: 'Diese Dateien sind bereits archiviert.',
      'not-archived': 'Nur archivierte Dateien lassen sich wiederherstellen.',
      'all-public': 'Alle ausgewählten Dateien sind öffentlich.',
      'all-private': 'Alle ausgewählten Dateien sind privat.',
      'too-many': 'Für diese Aktion geladene Dateien auswählen.',
    },
    moved: ({ count, folder }, format) =>
      `${format.number(count)} ${plural(count, format, 'Datei', 'Dateien')} nach ${folder} verschoben.`,
    archived: ({ count }, format) =>
      `${format.number(count)} ${plural(count, format, 'Datei', 'Dateien')} archiviert.`,
    archivedExternal: ({ count }, format) =>
      `${format.number(count)} davon ${plural(count, format, 'wird', 'werden')} noch außerhalb des CMS verwendet.`,
    restored: ({ count }, format) =>
      `${format.number(count)} ${plural(count, format, 'Datei', 'Dateien')} wiederhergestellt.`,
    visibility: ({ count, status }, format) =>
      `${format.number(count)} ${plural(count, format, 'Datei ist', 'Dateien sind')} jetzt ${status === 'public' ? 'öffentlich' : 'privat'}.`,
    undo: 'Rückgängig',
    undone: 'Rückgängig gemacht.',
    archiveInUse: ({ count }, format) =>
      `${format.number(count)} ${plural(count, format, 'Datei wird', 'Dateien werden')} noch verwendet. Trotzdem archivieren? Inhalte verweisen weiter darauf.`,
    archiveAnyway: 'Trotzdem archivieren',
    purged: ({ count }, format) =>
      plural(
        count,
        format,
        `${format.number(count)} Datei endgültig gelöscht.`,
        `${format.number(count)} Dateien endgültig gelöscht.`,
      ),
    purgeTitle: 'Endgültig löschen?',
    purgeDescription: ({ count }, format) =>
      plural(
        count,
        format,
        'Die Datei wird mit allen früheren Versionen und Renditionen gelöscht. Das lässt sich nicht rückgängig machen; Seiten, die sie noch verwenden, zeigen einen Platzhalter.',
        `${format.number(count)} Dateien werden mit allen früheren Versionen und Renditionen gelöscht. Das lässt sich nicht rückgängig machen; Seiten, die sie noch verwenden, zeigen einen Platzhalter.`,
      ),
    purgeTyping: ({ word }) => `Zum Bestätigen "${word}" eingeben.`,
  },
  processing: {
    pending: 'Wird auf Schadsoftware geprüft',
    failed: 'Gesperrt: Schadsoftware gefunden',
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
    started: ({ count }, format) =>
      `${format.number(count)} ${plural(count, format, 'Datei wird', 'Dateien werden')} hochgeladen`,
    finished: ({ done, total, failed }, format) =>
      failed > 0
        ? `${format.number(done)} von ${format.number(total)} Dateien hochgeladen, ${format.number(failed)} fehlgeschlagen`
        : `${format.number(done)} von ${format.number(total)} Dateien hochgeladen`,
    entryDone: ({ name }) => `${name} hochgeladen`,
    entryFailed: ({ name, reason }) => `${name} fehlgeschlagen: ${reason}`,
    entryCancelled: ({ name }) => `${name} abgebrochen`,
    cancel: 'Abbrechen',
    retry: 'Erneut versuchen',
    retryAll: 'Fehlgeschlagene wiederholen',
    pause: 'Anhalten',
    resume: 'Fortsetzen',
    duplicate: ({ name }) => `${name} ist schon in der Mediathek`,
    useExisting: 'Vorhandene verwenden',
    uploadAnyway: 'Trotzdem hochladen',
    waiting: ({ count }, format) =>
      plural(
        count,
        format,
        `Warte auf ${format.number(count)} Upload`,
        `Warte auf ${format.number(count)} Uploads`,
      ),
    camera: 'Foto aufnehmen',
    video: 'Video aufnehmen',
  },
  image: {
    provenance: { ai_generated: 'KI-generiert', ai_edited: 'KI-bearbeitet' },
  },
  usage: {
    title: 'Verwendung',
    count: ({ roots }, format) =>
      `Verwendet auf ${format.number(roots)} ${plural(roots, format, 'Seite', 'Seiten')}`,
    scopeLabel: 'Verwendung zeigen in',
    scope: {
      live: 'Allen Branches',
      published: 'Veröffentlicht',
      history: 'Historie',
    },
    missingAlt: 'Nur ohne Alt-Text',
    empty: 'Nirgends verwendet',
    loadMore: 'Mehr zeigen',
    external: 'Außerhalb des CMS verwendet',
    externalBlocking: 'Verhindert das Archivieren',
    hiddenRoots: ({ count }, format) =>
      plural(
        count,
        format,
        `${format.number(count)} weitere Seite ohne Zugriff`,
        `${format.number(count)} weitere Seiten ohne Zugriff`,
      ),
  },
  picker: {
    title: 'Datei auswählen',
    choose: 'Auswählen',
    select: 'Übernehmen',
    disabled: {
      dimensions: ({ minWidth, minHeight }, format) =>
        `Mindestens ${format.number(minWidth)} × ${format.number(minHeight)} px nötig`,
      type: ({ accepted }) => `Nur ${accepted}`,
      size: ({ max }, format) => `Größer als ${format.bytes(max)}`,
      aspect: ({ ratio }) => `Seitenverhältnis ${ratio} nötig`,
      max: ({ max }, format) => `Höchstens ${format.number(max)} auswählbar`,
    },
    confirm: ({ count }, format) =>
      count > 1 ? `${format.number(count)} übernehmen` : 'Übernehmen',
  },
  preview: {
    label: ({ name }) => `Vorschau von ${name}`,
    close: 'Vorschau schließen',
    prev: 'Zurück',
    next: 'Weiter',
    zoomIn: 'Vergrößern',
    zoomOut: 'Verkleinern',
    zoomReset: 'Einpassen',
    rotate: 'Drehen',
    position: ({ index, total }, format) =>
      `${format.number(index)} von ${format.number(total)}`,
    unavailable: 'Für diesen Dateityp gibt es keine Vorschau.',
  },
  detail: {
    title: 'Details',
    name: 'Dateiname',
    description: 'Beschreibung',
    rights: {
      credit: 'Bildnachweis',
      copyright: 'Copyright',
      license: 'Lizenz',
      licenseUrl: 'Lizenz-URL',
      sourceUrl: 'Quell-URL',
      expiresAt: 'Rechte enden am',
    },
    provenance: 'Herkunft',
    save: 'Speichern',
    saving: 'Speichert',
    reset: 'Änderungen verwerfen',
    saved: 'Änderungen gespeichert',
    conflict: ({ name }) =>
      `${name} wurde inzwischen von jemand anderem geändert.`,
    keepMine: 'Meine Änderungen behalten',
    takeTheirs: 'Andere Version übernehmen',
    revisions: 'Versionen',
    noRevisions: 'Keine früheren Versionen',
    restoreRevision: 'Diese Version wiederherstellen',
    revisionRestored: ({ name }) => `${name} wiederhergestellt`,
    facts: {
      type: 'Typ',
      size: 'Größe',
      dimensions: 'Abmessungen',
      created: 'Hochgeladen',
      updated: 'Geändert',
      uploadedBy: 'Hochgeladen von',
      provenanceSource: 'Herkunft laut',
    },
    dimensions: ({ width, height }, format) =>
      `${format.number(width)} × ${format.number(height)} px`,
  },
  focal: {
    label: 'Fokuspunkt',
    value: ({ x, y }) => `${x} % von links, ${y} % von oben`,
    reset: 'Fokuspunkt zentrieren',
    saved: 'Fokuspunkt gespeichert',
  },
  crop: {
    label: 'Zuschnitt',
    zoom: 'Zoom',
    aspect: 'Seitenverhältnis',
    free: 'Frei',
    original: 'Original',
    x: 'Links',
    y: 'Oben',
    width: 'Breite',
    height: 'Höhe',
    reset: 'Zuschnitt zurücksetzen',
    tooSmall: ({ minWidth }, format) =>
      `Der Zuschnitt ist schmaler als ${format.number(minWidth)} px`,
  },
  imageField: {
    alt: 'Alternativtext',
    altHint:
      'Beschreibe, was das Bild zeigt, für Menschen, die es nicht sehen.',
    decorative: 'Dekoratives Bild (ohne Alternativtext)',
    caption: 'Bildunterschrift',
    suggest: 'Vorschlagen',
    suggesting: 'Schlägt vor',
    suggested: 'Vorschlag, bitte prüfen',
    missingAlt: 'Alternativtext fehlt',
    replace: 'Bild ersetzen',
    remove: 'Bild entfernen',
    choose: 'Bild auswählen',
  },
  replace: {
    title: 'Datei ersetzen',
    confirm: 'Ersetzen',
    type: ({ from, to }) => `Der Typ ändert sich von ${from} zu ${to}.`,
    aspect: ({ from, to }) =>
      `Das Seitenverhältnis ändert sich von ${from} zu ${to}; Zuschnitte können sich verschieben.`,
    usage: ({ roots }, format) =>
      plural(
        roots,
        format,
        `Verwendet auf ${format.number(roots)} Seite; sie ändert sich mit.`,
        `Verwendet auf ${format.number(roots)} Seiten; alle ändern sich mit.`,
      ),
  },
  download: {
    button: 'Herunterladen',
    title: 'Downloads',
    cancel: 'Download abbrechen',
    clear: 'Fertige entfernen',
    status: {
      pending: 'Wartet',
      downloading: 'Lädt herunter',
      success: 'Fertig',
      error: 'Fehlgeschlagen',
      aborted: 'Abgebrochen',
    },
    progress: ({ loaded, total }, format) =>
      `${format.bytes(loaded)} von ${format.bytes(total)}`,
    started: ({ count }, format) =>
      plural(
        count,
        format,
        `${format.number(count)} Datei wird heruntergeladen`,
        `${format.number(count)} Dateien werden heruntergeladen`,
      ),
    finished: ({ name, skipped }, format) =>
      skipped > 0
        ? `${name} ist fertig, ${format.number(skipped)} übersprungen`
        : `${name} ist fertig`,
    failed: ({ reason }) => `Download fehlgeschlagen: ${reason}`,
  },
  shortcut: ({ key }, format) => (format.apple ? `⌘${key}` : `Strg+${key}`),
  error: {
    unknown: 'Etwas ist schiefgelaufen.',
    size: ({ max }, format) => `Die Datei ist größer als ${format.bytes(max)}.`,
    type: ({ accepted }) => `Erlaubt sind nur diese Dateitypen: ${accepted}.`,
    ASSET_ACCESS_DENIED: 'Diese Datei ist nicht verfügbar.',
    ASSET_CONFLICT: 'Jemand anderes hat diese Datei geändert.',
    ASSET_NOT_FOUND: 'Die Datei existiert nicht mehr.',
    CANNOT_MOVE_INTO_DESCENDANT:
      'Ein Ordner kann nicht in einen eigenen Unterordner verschoben werden.',
    CANNOT_MOVE_INTO_SELF:
      'Ein Ordner kann nicht in sich selbst verschoben werden.',
    CANNOT_REPLACE_VARIANT: 'Eine erzeugte Variante kann nicht ersetzt werden.',
    DOWNLOAD_FAILED: 'Der Download ist fehlgeschlagen.',
    DOWNLOAD_TOO_LARGE: 'Der Download ist für diesen Browser zu groß.',
    DOWNLOAD_UNSUPPORTED: 'Dieser Browser kann den Download nicht speichern.',
    FILE_TOO_LARGE: 'Die Datei ist zu groß.',
    FOLDER_HAS_CONTENT: 'Der Ordner ist nicht leer.',
    FOLDER_NAME_TAKEN: 'Hier gibt es bereits einen Ordner mit diesem Namen.',
    FOLDER_NOT_FOUND: 'Der Ordner existiert nicht mehr.',
    INVALID_FILE_TYPE: 'Dieser Dateityp ist nicht erlaubt.',
    NETWORK_ERROR: 'Die Verbindung wurde unterbrochen.',
    PARENT_NOT_FOUND: 'Der Zielordner existiert nicht mehr.',
    RATE_LIMITED: 'Zu viele Anfragen. Bitte kurz warten und erneut versuchen.',
    SLUG_GENERATION_FAILED: 'Es wurde kein freier Dateiname gefunden.',
    STORAGE_UNSUPPORTED: 'Der Speicher unterstützt diesen Upload nicht.',
    TOO_MANY_FILES: 'Zu viele Dateien auf einmal.',
    UNSUPPORTED: 'Diese Aktion ist nicht verfügbar.',
    UPLOAD_EXPIRED: 'Der Upload-Link ist abgelaufen.',
    UPLOAD_FAILED: 'Der Upload ist fehlgeschlagen.',
    UPLOAD_NOT_FOUND:
      'Die hochgeladene Datei wurde im Speicher nicht gefunden.',
    UPLOAD_TOKEN_INVALID: 'Der Upload konnte nicht bestätigt werden.',
    VERSION_CONFLICT:
      'Jemand anderes hat diese Datei geändert. Neu laden und erneut versuchen.',
  },
};
