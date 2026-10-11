const LINE = '.harness/';

/**
 * @param {string | null | undefined} content
 */
export function mergeGitignore(content) {
  const text = content ?? '';
  if (text.split('\n').some((line) => line.trim() === LINE)) {
    if (!text || text.endsWith('\n')) return text || `${LINE}\n`;
    return `${text}\n`;
  }
  if (!text) return `${LINE}\n`;
  return text.endsWith('\n') ? `${text}${LINE}\n` : `${text}\n${LINE}\n`;
}
