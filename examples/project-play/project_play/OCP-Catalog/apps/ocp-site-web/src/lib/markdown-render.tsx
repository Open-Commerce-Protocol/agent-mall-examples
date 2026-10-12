import { Children, isValidElement, type ReactNode } from 'react';

export function extractTextFromNode(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') {
    return '';
  }
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => extractTextFromNode(child)).join('');
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return extractTextFromNode(node.props.children);
  }
  return Children.toArray(node).map((child) => extractTextFromNode(child)).join('');
}

export function splitTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

export function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length > 1 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parsePipeTable(value: string): string[][] | null {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3 || !lines.every((line) => line.startsWith('|') && line.endsWith('|'))) {
    return null;
  }
  if (!isTableSeparator(lines[1])) {
    return null;
  }

  const rows = lines.filter((_, index) => index !== 1).map(splitTableRow);
  const columnCount = rows[0]?.length ?? 0;

  if (columnCount < 2 || rows.some((row) => row.length !== columnCount)) {
    return null;
  }
  return rows;
}

export function renderTableCellContent(value: string): ReactNode {
  return value
    .split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
    .filter(Boolean)
    .map((part, index) => {
      if (part.startsWith('`') && part.endsWith('`')) {
        return <code key={index}>{part.slice(1, -1)}</code>;
      }
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
}

/** Resolve a relative `images/...` path to a site-absolute `/images/...` URL. */
export function resolvePublicImageSrc(src: string | undefined): string | undefined {
  return src?.startsWith('images/') ? `/${src}` : src;
}

/** Resolve markdown image src under public/images and render with site styling. */
export function renderMarkdownImage(src: string | undefined, alt: string | undefined) {
  const imageSrc = resolvePublicImageSrc(src);
  return <img src={imageSrc} alt={alt ?? ''} className="rounded-lg border border-black/10" />;
}
