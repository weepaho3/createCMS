import * as React from 'react';

import type { CanvasFrameOptions, CanvasFrameWrapper } from './frame-shell';

/**
 * Frame settings for live e-mail editing: the compiled e-mail stylesheet
 * as the only styles (nothing mirrored from the host page), no body
 * margin, and a centered table of `width` (default 600) around the
 * blocks. Compiled output (react-email `<Tailwind>`, render to string)
 * belongs in `Editor.FramePreview`, never in the live frame.
 */
export function emailFrame(options: {
  sheet: string;
  width?: number;
  background?: string;
}): { frame: CanvasFrameOptions; wrapper: CanvasFrameWrapper } {
  const width = options.width ?? 600;
  const background = options.background ?? '#ffffff';
  function EmailWrapper({ children }: { children: React.ReactNode }) {
    return (
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        data-editor-email-wrapper=""
      >
        <tbody>
          <tr>
            <td align="center">
              <table
                role="presentation"
                width={width}
                cellPadding={0}
                cellSpacing={0}
                style={{ width, background }}
              >
                <tbody>
                  <tr>
                    <td>{children}</td>
                  </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody>
      </table>
    );
  }
  return {
    frame: {
      head: `<style>${options.sheet}</style>`,
      bodyAttributes: { style: 'margin:0' },
      styles: 'none',
    },
    wrapper: EmailWrapper,
  };
}
