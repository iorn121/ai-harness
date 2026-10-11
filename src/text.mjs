/**
 * @param {string} brief
 */
export function firstLine(brief) {
  const line = String(brief ?? '')
    .split('\n')
    .map((part) => part.trim())
    .find(Boolean);
  return (line ?? '').replace(/^#+\s*/, '').trim();
}

/**
 * @param {Date} now
 */
export function formatDay(now) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * @param {string} brief
 * @param {Date} now
 */
/**
 * @param {string} text
 */
export function englishSlug(text) {
  const labeled = String(text ?? '').match(/^slug:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/im);
  if (labeled) return labeled[1].slice(0, 48);
  const ascii = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return ascii || 'change';
}

/**
 * @param {string} brief
 * @param {Date} now
 */
export function slugFromBrief(brief, now) {
  return `${formatDay(now)}-${englishSlug(brief)}`;
}

/**
 * @param {string} specText
 * @param {string} fallbackBranch
 * @param {Date} now
 */
export function englishBranch(specText, fallbackBranch, now) {
  const labeled = String(specText ?? '').match(/^slug:\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*$/im);
  const slug = labeled?.[1]?.slice(0, 48);
  if (
    typeof fallbackBranch === 'string' &&
    /^harness\/[A-Za-z0-9._/-]+$/.test(fallbackBranch) &&
    !/[^\u0000-\u007F]/.test(fallbackBranch)
  ) {
    const tail = fallbackBranch.slice('harness/'.length);
    if (!slug || tail.endsWith(`-${slug}`) || !tail.endsWith('-change')) return fallbackBranch;
    return `harness/${formatDay(now)}-${slug}`;
  }
  if (slug) return `harness/${formatDay(now)}-${slug}`;
  return `harness/${formatDay(now)}-change`;
}

/**
 * @param {string} specDir
 * @param {string} slug
 */
export function specRelativePath(specDir, slug) {
  const dir = String(specDir ?? 'docs/specs')
    .replace(/\\/g, '/')
    .replace(/\/+$/g, '');
  return `${dir}/${slug}.md`;
}

/**
 * @param {string} brief
 */
/**
 * @param {string} branch
 */
export function commitTitle(branch) {
  const words = String(branch ?? '')
    .replace(/^harness\//, '')
    .replace(/^\d{8}-/, '')
    .replace(/-/g, ' ')
    .trim();
  return `feat: ${words || 'update'}`;
}

/**
 * Git が `core.quotepath` で付ける C 言語風の引用を、UTF-8 のパスに戻す。
 * @param {string} pathPart
 */
export function decodeGitPath(pathPart) {
  const trimmed = pathPart.trim();
  if (!(trimmed.startsWith('"') && trimmed.endsWith('"'))) return trimmed;
  const body = trimmed.slice(1, -1);
  const bytes = [];
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === '\\' && /^[0-7]{3}$/.test(body.slice(index + 1, index + 4))) {
      bytes.push(Number.parseInt(body.slice(index + 1, index + 4), 8));
      index += 3;
      continue;
    }
    if (body[index] === '\\') {
      const next = body[index + 1] ?? '';
      const escaped =
        next === 'n' ? '\n' : next === 't' ? '\t' : next === '"' || next === '\\' ? next : next;
      bytes.push(...Buffer.from(escaped, 'utf8'));
      index += 1;
      continue;
    }
    bytes.push(...Buffer.from(body[index], 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

/**
 * `git status --porcelain=v1` のパスだけを取り出す。
 * @param {string} text
 */
export function parsePorcelain(text) {
  return String(text ?? '')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const pathPart = line.slice(3).trim();
      const renamed = pathPart.split(' -> ').pop() ?? '';
      return decodeGitPath(renamed);
    })
    .filter(Boolean);
}

/**
 * @param {string[]} paths
 * @param {string} specPath
 */
export function unexpectedSpecChanges(paths, specPath) {
  return paths.filter((filePath) => filePath !== specPath && !filePath.startsWith('.harness/'));
}
