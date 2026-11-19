// Shared by discovery and routing so direct helpers preserve configuration failures.
export class ContextError extends Error {
  constructor(message, exitCode = 2) { super(`wiki-master: ${message}`); this.name = 'ContextError'; this.exitCode = exitCode; }
}
