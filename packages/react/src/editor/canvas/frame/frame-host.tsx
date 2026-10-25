import * as React from 'react';
import { createPortal } from 'react-dom';

import { composeRefs } from '../../../use-render';
import { isHTMLElement } from '../../dom';

/** A live connection to the frame's srcdoc document. */
export type FrameConnection = {
  readonly frame: HTMLIFrameElement;
  readonly document: Document;
  readonly window: Window;
  /** Where the portal renders: a div in the frame body. */
  readonly mountNode: HTMLElement;
};

const MOUNT_ATTR = 'data-editor-frame-root';
const HEAD_ATTR = 'data-editor-frame-head';

/**
 * The frame document never changes: `head` and body attributes are patched
 * into it, so a theme or sheet change never reloads the frame (no white
 * flash, scroll position kept).
 */
export const FRAME_SRCDOC =
  '<!doctype html><html><head><meta charset="utf-8"></head>' +
  `<body><div ${MOUNT_ATTR}="" translate="no" class="notranslate"></div></body></html>`;

/** Replaces the head elements a previous `head` string added with `head`'s. */
export function patchFrameHead(doc: Document, head: string): void {
  for (const node of doc.head.querySelectorAll(`[${HEAD_ATTR}]`)) {
    node.remove();
  }
  if (!head) return;
  const template = doc.createElement('template');
  template.innerHTML = head;
  for (const node of Array.from(template.content.children)) {
    node.setAttribute(HEAD_ATTR, '');
    doc.head.append(node);
  }
}

/**
 * Sets `next` on the frame body and removes the attributes `previous` set
 * that `next` no longer has.
 */
export function patchBodyAttributes(
  doc: Document,
  previous: Readonly<Record<string, string>>,
  next: Readonly<Record<string, string>>,
): void {
  for (const name of Object.keys(previous)) {
    if (!(name in next)) doc.body.removeAttribute(name);
  }
  for (const [name, value] of Object.entries(next)) {
    if (doc.body.getAttribute(name) !== value) {
      doc.body.setAttribute(name, value);
    }
  }
}

export type FrameHostProps = {
  /** Markup for the frame head (stylesheets, fonts); patched in place. */
  head?: string;
  bodyAttributes?: Readonly<Record<string, string>>;
  /** Omitted when undefined; see `Canvas.Root`'s `frame.sandbox`. */
  sandbox?: string;
  title: string;
  style?: React.CSSProperties;
  frameRef?: React.Ref<HTMLIFrameElement>;
  /** Called with each new connection, and `null` when it is gone. */
  onConnection?: (connection: FrameConnection | null) => void;
  children?: React.ReactNode;
};

const NO_ATTRIBUTES: Readonly<Record<string, string>> = {};

/**
 * A same-origin srcdoc iframe whose children render through a portal into
 * the frame body. Nothing renders before the srcdoc document loaded; a
 * reload (the frame navigated or was reloaded) replaces the document, and
 * the persistent `load` listener connects the new one, so the portal
 * remounts there and the old mount node ends empty.
 */
export function FrameHost({
  head = '',
  bodyAttributes = NO_ATTRIBUTES,
  sandbox,
  title,
  style,
  frameRef,
  onConnection,
  children,
}: FrameHostProps) {
  const [frame, setFrame] = React.useState<HTMLIFrameElement | null>(null);
  const [connection, setConnection] = React.useState<FrameConnection | null>(
    null,
  );
  const onConnectionRef = React.useRef(onConnection);
  const headRef = React.useRef(head);
  const bodyRef = React.useRef(bodyAttributes);
  const appliedBodyRef =
    React.useRef<Readonly<Record<string, string>>>(NO_ATTRIBUTES);
  React.useLayoutEffect(() => {
    onConnectionRef.current = onConnection;
    headRef.current = head;
    bodyRef.current = bodyAttributes;
  });

  React.useEffect(() => {
    if (!frame) return;
    let current: FrameConnection | null = null;
    const connect = () => {
      const doc = frame.contentDocument;
      const view = frame.contentWindow;
      // The initial about:blank document is never a mount target.
      if (!doc || !view || !doc.body || doc.URL !== 'about:srcdoc') return;
      if (current?.document === doc) return;
      const found = doc.body.querySelector(`[${MOUNT_ATTR}]`);
      const mountNode = isHTMLElement(found) ? found : doc.createElement('div');
      if (mountNode !== found) {
        mountNode.setAttribute(MOUNT_ATTR, '');
        doc.body.append(mountNode);
      }
      patchFrameHead(doc, headRef.current);
      appliedBodyRef.current = NO_ATTRIBUTES;
      patchBodyAttributes(doc, NO_ATTRIBUTES, bodyRef.current);
      appliedBodyRef.current = bodyRef.current;
      current = { frame, document: doc, window: view, mountNode };
      setConnection(current);
      onConnectionRef.current?.(current);
    };
    // A load that fired before this effect (StrictMode re-run) still counts.
    if (frame.contentDocument?.readyState === 'complete') connect();
    frame.addEventListener('load', connect);
    return () => {
      frame.removeEventListener('load', connect);
      current = null;
      setConnection(null);
      onConnectionRef.current?.(null);
    };
  }, [frame]);

  React.useLayoutEffect(() => {
    if (connection) patchFrameHead(connection.document, head);
  }, [connection, head]);

  React.useLayoutEffect(() => {
    if (!connection) return;
    patchBodyAttributes(
      connection.document,
      appliedBodyRef.current,
      bodyAttributes,
    );
    appliedBodyRef.current = bodyAttributes;
  }, [connection, bodyAttributes]);

  const setRefs = React.useMemo(
    () => composeRefs<HTMLIFrameElement>(setFrame, frameRef),
    [frameRef],
  );

  return (
    <>
      <iframe
        ref={setRefs}
        title={title}
        srcDoc={FRAME_SRCDOC}
        sandbox={sandbox}
        style={style}
      />
      {connection ? createPortal(children, connection.mountNode) : null}
    </>
  );
}
