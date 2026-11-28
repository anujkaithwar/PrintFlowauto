export function getAppBasePath(): string {
  if (typeof window === 'undefined') return '';
  let path = window.location.pathname || '/';
  path = path.replace(/\/index\.html$/i, '');
  if (path === '/' || path === '') return '';
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${getAppBasePath()}${normalized}`;
}

export function appPath(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${getAppBasePath()}${normalized}`;
}
