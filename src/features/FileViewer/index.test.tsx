import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import FileViewer from './index';

const viewerProps = vi.hoisted(() => ({ msdoc: [] as any[], pdf: [] as any[] }));

vi.mock('./Renderer/MSDoc', () => ({
  default: (props: any) => {
    viewerProps.msdoc.push(props);
    return <div data-testid="msdoc" />;
  },
}));
vi.mock('./Renderer/PDF', () => ({
  default: (props: any) => {
    viewerProps.pdf.push(props);
    return <div data-testid="pdf" />;
  },
}));
vi.mock('./Renderer/Image', () => ({ default: () => null }));
vi.mock('./Renderer/Video', () => ({ default: () => null }));
vi.mock('./Renderer/HTML', () => ({ default: () => null }));
vi.mock('./Renderer/Code', () => ({ default: () => null }));
vi.mock('./NotSupport', () => ({ default: () => null }));

const base = {
  chunkCount: null,
  chunkingError: null,
  chunkingStatus: null,
  createdAt: new Date(),
  embeddingError: null,
  embeddingStatus: null,
  finishEmbedding: false,
  metadata: null,
  parentId: null,
  size: 1,
  slug: null,
  sourceType: 'file',
  updatedAt: new Date(),
} as any;

describe('FileViewer backing file id', () => {
  it('hands the backing file id to the Office viewer for file-backed documents', () => {
    render(
      <FileViewer
        {...base}
        fileId="file_abc"
        fileType="application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        id="docs_123"
        name="report.docx"
        url="https://example.com/report.docx"
      />,
    );

    expect(viewerProps.msdoc.at(-1)).toMatchObject({ fileId: 'file_abc', fileName: 'report.docx' });
  });

  it('falls back to the item id when there is no backing file', () => {
    render(
      <FileViewer {...base} fileId={null} fileType="pdf" id="file_pdf" name="a.pdf" url="u" />,
    );

    expect(viewerProps.pdf.at(-1)).toMatchObject({ fileId: 'file_pdf' });
  });
});
