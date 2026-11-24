import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveProductPath } from '../src/products.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('resolves a catalog id to an absolute path', () => {
  const catalog = [{ id: 'demo', path: '../demo' }];
  assert.equal(resolveProductPath(catalog, 'demo', root), path.resolve(root, '../demo'));
  assert.throws(() => resolveProductPath(catalog, 'missing', root), /不明なプロダクト/);
});

test('catalog entries point at workspace products when those checkouts exist', () => {
  const catalog = JSON.parse(readFileSync(path.join(root, 'products.json'), 'utf8'));
  assert.ok(catalog.length >= 9);
  const missing = catalog.filter((item) => !existsSync(resolveProductPath(catalog, item.id, root)));
  if (missing.length === catalog.length) return;
  assert.deepEqual(
    missing.map((item) => item.id),
    [],
  );
});
