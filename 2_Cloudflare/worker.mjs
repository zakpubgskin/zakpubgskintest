import payload from '../1_GitHub/2.lua';

const MAX_FORM_BYTES = 1024;
const COMMON_HEADERS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
});

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function response(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { ...COMMON_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extraHeaders },
  });
}

async function readForm(request) {
  const type = (request.headers.get('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/x-www-form-urlencoded') throw new RequestError(400, 'Expected form data');
  const length = request.headers.get('Content-Length');
  if (length !== null && !/^\d+$/.test(length)) throw new RequestError(400, 'Invalid request length');
  if (length !== null && Number(length) > MAX_FORM_BYTES) throw new RequestError(413, 'Request too large');
  let text = '';
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_FORM_BYTES) {
          await reader.cancel().catch(() => {});
          throw new RequestError(413, 'Request too large');
        }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(400, 'Invalid request body');
    } finally {
      reader.releaseLock();
    }
  }
  const form = new URLSearchParams(text);
  if (form.getAll('key_path').length !== 1 || [...form.keys()].some(key => key !== 'key_path')) {
    throw new RequestError(400, 'Expected one key_path');
  }
  return form.get('key_path');
}

// No digest, byte count, release ID or marker is required to publish new Lua.
function createHandler({ payload, primaryName = '2.lua', basePath = '/' }) {
  if (typeof payload !== 'string' || !payload.length) throw new TypeError('Payload must be nonempty Lua text');
  if (typeof primaryName !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.lua$/.test(primaryName)) {
    throw new TypeError('Invalid payload name');
  }
  if (typeof basePath !== 'string' || !basePath.startsWith('/') || !basePath.endsWith('/')) {
    throw new TypeError('basePath must start and end with /');
  }
  const health = JSON.stringify({ ok: true, payload: primaryName });
  return async function fetch(request) {
    try {
      const path = new URL(request.url).pathname;
      const isRoot = path === basePath;
      const isPayload = path === basePath + primaryName;
      const isHealth = path === basePath + 'health';
      if (!isRoot && !isPayload && !isHealth) return response('Not found', 404);
      const method = request.method.toUpperCase();
      if (method === 'OPTIONS') return response(null, 204);
      if (method === 'GET' || method === 'HEAD') {
        if (isHealth) return response(method === 'HEAD' ? null : health, 200, { 'Content-Type': 'application/json; charset=utf-8' });
        if (isPayload) return response(method === 'HEAD' ? null : payload);
        return response('Not found', 404);
      }
      if (method === 'POST' && isRoot) {
        if (await readForm(request) !== primaryName) return response('Not found', 404);
        return response(payload);
      }
      return response('Method not allowed', 405, { Allow: isRoot ? 'POST, OPTIONS' : 'GET, HEAD, OPTIONS' });
    } catch (error) {
      return error instanceof RequestError ? response(error.message, error.status) : response('Internal error', 500);
    }
  };
}


export default {
  fetch: createHandler({ payload, primaryName: "2.lua", basePath: "/" }),
};
