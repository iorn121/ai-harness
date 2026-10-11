import path from 'node:path';
import { HarnessError } from './errors.mjs';

/**
 * @param {unknown} catalog
 * @param {string} id
 * @param {string} harnessRoot
 */
export function resolveProductPath(catalog, id, harnessRoot) {
  if (!Array.isArray(catalog)) {
    throw new HarnessError('products.json は配列である必要があります');
  }
  const item = catalog.find((entry) => entry && typeof entry === 'object' && entry.id === id);
  if (!item || typeof item.path !== 'string') {
    const ids = catalog
      .map((entry) => (entry && typeof entry.id === 'string' ? entry.id : ''))
      .filter(Boolean)
      .join(', ');
    throw new HarnessError(`不明なプロダクトです: ${id}（${ids}）`);
  }
  return path.resolve(harnessRoot, item.path);
}
