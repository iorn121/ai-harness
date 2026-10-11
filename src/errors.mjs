export class HarnessError extends Error {
  /**
   * @param {string} message
   * @param {number} exitCode
   */
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'HarnessError';
    this.exitCode = exitCode;
  }
}
