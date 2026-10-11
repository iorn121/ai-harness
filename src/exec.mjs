import { spawn } from 'node:child_process';

const MAX_OUTPUT = 200_000;

/**
 * @param {string} previous
 * @param {string} chunk
 */
function appendTail(previous, chunk) {
  const next = previous + chunk;
  return next.length > MAX_OUTPUT ? next.slice(-MAX_OUTPUT) : next;
}

/**
 * @param {string | string[]} command
 * @param {{ cwd?: string, input?: string }} [options]
 */
export function runCommand(command, options = {}) {
  const cwd = options.cwd;
  const child = Array.isArray(command)
    ? spawn(command[0], command.slice(1), { cwd, env: process.env })
    : spawn(command, { cwd, env: process.env, shell: true });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    const text = String(chunk);
    stdout = appendTail(stdout, text);
    process.stdout.write(text);
  });
  child.stderr?.on('data', (chunk) => {
    const text = String(chunk);
    stderr = appendTail(stderr, text);
    process.stderr.write(text);
  });
  if (options.input != null) child.stdin?.end(options.input);
  else child.stdin?.end();

  return new Promise((resolve) => {
    child.on('error', (error) => {
      resolve({ code: 127, stdout, stderr: appendTail(stderr, error.message) });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
