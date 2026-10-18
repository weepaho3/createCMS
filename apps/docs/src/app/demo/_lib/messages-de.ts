import type { AnnouncedBlock, Messages } from '@createcms/react/editor/core';

type Params = Readonly<Record<string, unknown>>;

const value = (params: Params, key: string, fallback = ''): string => {
  const v = params[key];
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return v === undefined ? fallback : JSON.stringify(v);
};

const named = (block: AnnouncedBlock): string =>
  block.excerpt ? `${block.label} "${block.excerpt}"` : block.label;

/** A complete German catalog: the type makes every entry required. */
export const messagesDe: Messages = {
  field: {
    required: () => 'Dieses Feld ist erforderlich.',
    type: (p) => `Muss ${value(p, 'expected', 'ein gültiger Wert')} sein.`,
    format: () => 'Muss ein ISO-8601-Zeitpunkt (UTC) sein.',
    minLength: (p) => `Mindestens ${value(p, 'min')} Zeichen.`,
    maxLength: (p) => `Höchstens ${value(p, 'max')} Zeichen.`,
    pattern: () => 'Das Format ist ungültig.',
    min: (p) => `Mindestens ${value(p, 'min')}.`,
    max: (p) => `Höchstens ${value(p, 'max')}.`,
    step: (p) => `Muss ein Vielfaches von ${value(p, 'step')} sein.`,
    minItems: (p) => `Mindestens ${value(p, 'min')} Einträge.`,
    maxItems: (p) => `Höchstens ${value(p, 'max')} Einträge.`,
    option: () => 'Muss eine der Optionen sein.',
    linkKind: () => 'Diese Linkart ist nicht erlaubt.',
    linkCollection: () => 'Links auf diese Sammlung sind nicht erlaubt.',
    linkTarget: () => 'Der Link braucht ein Ziel.',
    responsive: () => 'Dieses Feld hat keine Werte pro Breakpoint.',
    localized: () => 'Dieses Feld hat keine Werte pro Sprache.',
  },
  structure: {
    duplicateId: () => 'Diese Block-ID kommt doppelt vor.',
    unknownType: (p) => `Unbekannter Blocktyp "${value(p, 'type')}".`,
    unknownSlot: () => 'Dieser Slot ist für den Blocktyp nicht deklariert.',
    placement: (p) =>
      `Ein ${value(p, 'type', 'Block')} darf nicht in diesen Slot.`,
    slotMin: (p) => `Braucht mindestens ${value(p, 'min')} Block(e).`,
    slotMax: (p) => `Nimmt höchstens ${value(p, 'max')} Block(e).`,
  },
  schema: (p) => value(p, 'message', 'Der Wert ist ungültig.'),
  parts: {
    dragHandle: 'Zum Verschieben ziehen',
    inlineText: 'Text bearbeiten',
    framePreview: 'Vorschau',
    blockError: (p) => `${p.type} (${p.id}) konnte nicht dargestellt werden`,
    unknownBlock: (p) => `Unbekannter Blocktyp "${p.type}"`,
    listAdd: (p) => `${p.label} hinzufügen`,
    listAddText: 'Hinzufügen',
    listRemove: (p) => `${p.label} ${p.position} entfernen`,
    listRemoveText: 'Entfernen',
    listMoveUp: (p) => `${p.label} ${p.position} nach oben`,
    listMoveUpText: 'Nach oben',
    listMoveDown: (p) => `${p.label} ${p.position} nach unten`,
    listMoveDownText: 'Nach unten',
    errorSummaryTitle: (p) =>
      p.count === 1 ? '1 Problem beheben' : `${p.count} Probleme beheben`,
    shortcutsTitle: 'Tastenkürzel',
    shortcutsClose: 'Schließen',
    blockToolbar: (p) => `Aktionen für ${p.label}`,
    outline: 'Seitenstruktur',
    contextMenu: 'Blockaktionen',
    contextSelect: (p) => `${named(p.block)} auswählen`,
    contextSelectBelow: (p) => `Ebene darunter auswählen: ${named(p.block)}`,
  },
  commands: {
    'history.undo': 'Rückgängig',
    'history.redo': 'Wiederholen',
    'block.remove': 'Löschen',
    'block.duplicate': 'Duplizieren',
    'block.moveUp': 'Nach oben',
    'block.moveDown': 'Nach unten',
    'block.wrap': 'In Container packen',
    'selection.parent': 'Übergeordneten Block wählen',
    'selection.firstChild': 'Ersten Unterblock wählen',
    'selection.next': 'Nächsten Block wählen',
    'selection.previous': 'Vorherigen Block wählen',
    'selection.siblings': 'Alle Geschwister wählen',
    'clipboard.copy': 'Kopieren',
    'clipboard.cut': 'Ausschneiden',
    'clipboard.paste': 'Einfügen',
    'clipboard.copyProps': 'Eigenschaften kopieren',
    'clipboard.pasteProps': 'Eigenschaften einfügen',
    'ui.commandPalette': 'Befehlspalette',
    'ui.quickInsert': 'Schnell einfügen',
    'ui.toolbar': 'Block-Werkzeugleiste fokussieren',
    'ui.shortcutHelp': 'Tastenkürzel',
  },
  announce: {
    inserted: (p) =>
      `${named(p.block)} eingefügt an Position ${p.position} von ${p.count} in ${p.parent}.`,
    moved: (p) =>
      `${named(p.block)} verschoben auf Position ${p.position} von ${p.count} in ${p.parent}.`,
    removed: (p) => `${named(p.block)} entfernt.`,
    undone: (p) =>
      p.label ? `Rückgängig: ${p.label}.` : 'Rückgängig gemacht.',
    redone: (p) => (p.label ? `Wiederholt: ${p.label}.` : 'Wiederholt.'),
    editingStarted: (p) => `${p.field} von ${named(p.block)} wird bearbeitet.`,
    editingEnded: (p) => `Bearbeitung von ${p.field} beendet.`,
    root: 'der Seite',
    refused: 'Das ist hier nicht möglich.',
    dragPickedUp: (p) =>
      `${named(p.block)} aufgenommen. Position ${p.position} von ${p.count} in ${p.parent}.`,
    dragMoved: (p) =>
      `Bewegt in ${p.parent}, Position ${p.position} von ${p.count}.`,
    dragDropped: (p) =>
      `${named(p.block)} in ${p.parent} abgelegt, Position ${p.position}.`,
    dragCancelled: (p) =>
      `Abgebrochen, ${named(p.block)} zurück auf Position ${p.position} von ${p.count} in ${p.parent}.`,
    dragSourceRemoved: 'Ziehen abgebrochen: der Block wurde entfernt.',
    dragNoTargets: 'Dieser Block kann nirgendwo anders hin.',
  },
  keys: {
    apple: { mod: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧', separator: '' },
    other: {
      mod: 'Strg',
      ctrl: 'Strg',
      alt: 'Alt',
      shift: 'Umschalt',
      separator: '+',
    },
  },
};
