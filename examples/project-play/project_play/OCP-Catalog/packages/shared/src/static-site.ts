import { existsSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve } from 'node:path';

export type StaticSiteHandler = (pathname: string) => Promise<Response | null>;

export function hasStaticSite(siteRoot: string, indexFile = 'index.html'): boolean {
  return existsSync(resolve(siteRoot, indexFile));
}

export function createSpaStaticSiteHandler(siteRoot: string, indexFile = 'index.html'): StaticSiteHandler {
  const root = resolve(siteRoot);
  const rootIndex = resolve(root, indexFile);

  return async (pathname: string) => {
    if (!hasStaticSite(root, indexFile)) {
      return null;
    }

    const safePath = normalizeRequestPath(pathname, indexFile);
    const candidate = resolve(root, `.${safePath}`);

    let targetPath = rootIndex;
    const relativePath = relative(root, candidate);
    const insideRoot = relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath);

    if (insideRoot && existsSync(candidate) && statSync(candidate).isFile()) {
      targetPath = candidate;
    } else if (insideRoot && looksLikeStaticAsset(pathname)) {
      return new Response('Not Found', { status: 404 });
    }

    const file = Bun.file(targetPath);
    const headers = new Headers();
    const contentType = contentTypeForPath(targetPath);
    if (contentType) {
      headers.set('Content-Type', contentType);
    }

    return new Response(file, { headers });
  };
}

function normalizeRequestPath(pathname: string, indexFile: string): string {
  if (!pathname || pathname === '/') {
    return `/${indexFile}`;
  }

  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function looksLikeStaticAsset(pathname: string): boolean {
  const extension = extname(pathname).toLowerCase();
  return extension.length > 1;
}

function contentTypeForPath(pathname: string): string | null {
  switch (extname(pathname).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.ico':
      return 'image/x-icon';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.map':
      return 'application/json; charset=utf-8';
    default:
      return null;
  }
}
