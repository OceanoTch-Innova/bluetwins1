const API_PREFIX = '/api';
const UPSTREAM_TIMEOUT_MS = 10_000;
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const HOP_BY_HOP_HEADERS = [
  'connection',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
];

function jsonError(status, error) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function isLoopbackHost(hostname) {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

function mayUseInsecureLocalApi(request, env) {
  // Esta excepción sólo aplica a `wrangler dev` en loopback y requiere una
  // habilitación explícita en .dev.vars. Un Worker desplegado nunca recibe una
  // solicitud cuyo hostname sea loopback.
  return env.ALLOW_INSECURE_LOCAL_API === 'true'
    && isLoopbackHost(new URL(request.url).hostname);
}

function configuredApiOrigin(value, allowInsecureLoopback = false) {
  if (typeof value !== 'string' || value.trim() === '') return null;

  try {
    const url = new URL(value);
    const isHttps = url.protocol === 'https:';
    const isAllowedInsecureLoopback = allowInsecureLoopback
      && url.protocol === 'http:'
      && isLoopbackHost(url.hostname);
    const hasOnlyOrigin = url.pathname === '/' && !url.search && !url.hash;
    if (!isHttps && !isAllowedInsecureLoopback) return null;
    if (!hasOnlyOrigin || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}

function isApiRequest(request) {
  const { pathname } = new URL(request.url);
  return pathname === API_PREFIX || pathname.startsWith(`${API_PREFIX}/`);
}

function upstreamRequest(request, apiOrigin) {
  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, apiOrigin);
  const headers = new Headers(request.headers);

  // Los encabezados hop-by-hop describen la conexión Worker↔cliente, no la del
  // Worker↔API. Authorization y Cookie no se eliminan y viajan sin cambios.
  for (const header of HOP_BY_HOP_HEADERS) headers.delete(header);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return new Request(targetUrl, {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    // Node necesita esta opción al probar cuerpos de tipo ReadableStream. Los
    // Workers ignoran esta propiedad no estándar para su implementación fetch.
    duplex: hasBody ? 'half' : undefined,
    redirect: 'manual',
  });
}

export function createWorker(fetchImpl = globalThis.fetch) {
  return {
    async fetch(request, env) {
      if (!isApiRequest(request)) {
        if (!env.ASSETS || typeof env.ASSETS.fetch !== 'function') {
          return jsonError(500, 'Static assets binding is not configured.');
        }
        return env.ASSETS.fetch(request);
      }

      const apiOrigin = configuredApiOrigin(
        env.API_ORIGIN,
        mayUseInsecureLocalApi(request, env)
      );
      if (!apiOrigin) {
        return jsonError(
          503,
          'API service is not configured. Set the API_ORIGIN Worker secret to the backend origin.'
        );
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

      try {
        const response = await fetchImpl(upstreamRequest(request, apiOrigin), {
          signal: controller.signal,
        });

        // Devolver la respuesta original conserva estado, cuerpo y todos los
        // encabezados de la API, incluidos Set-Cookie.
        return response;
      } catch {
        return jsonError(502, 'API service is unavailable. Please try again later.');
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export default createWorker();
