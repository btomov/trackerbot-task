// Fixed messages keep errors useful without exposing cookies or response HTML.
const MESSAGES = {
  network: 'Could not reach Amazon. Check your connection.',
  timeout: 'Amazon took too long to respond. Try again.',
  http: 'Amazon returned an unsuccessful response. Try again later.',
  'unexpected-origin': 'Amazon redirected to an unexpected domain.',
  'response-too-large': 'Amazon returned more HTML than this extension can process.',
  'parser-unavailable': 'The HTML parser could not start. Reload the extension.',
  'parse-failed': 'The Amazon response could not be parsed.',
  'storage-read': 'The local cache could not be read.',
  'storage-write': 'The result could not be saved on this device.',
  'preference-write': 'The marketplace selection could not be saved.',
  messaging: 'The background worker did not respond. Reload the extension.',
  'check-failed': 'The account check could not finish. Try again.',
  'bad-request': 'Unknown marketplace or request.',
};

export const messageFor = (code) => MESSAGES[code];

export function fail(code, status) {
  throw Object.assign(new Error(MESSAGES[code]), { code, status });
}

export function errorInfo(error, fallback = 'check-failed') {
  const code = Object.hasOwn(MESSAGES, error?.code) ? error.code : fallback;
  const status = Number.isInteger(error?.status) ? error.status : null;
  return { code, message: MESSAGES[code] + (status ? ` (HTTP ${status})` : '') };
}
