export function newRequestId(): string {
  return globalThis.crypto?.randomUUID?.() || `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function routeTemplate(path: string): string {
  return path.split('?')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')
    .replace(/\/(?:[0-9a-f]{16,}|\d+)(?=\/|$)/gi, '/:id');
}

export function logClientDiagnostic(operation: string, route: string, status: number | string, startedAt: number, requestId = newRequestId()): void {
  const details = { operation, route_template: routeTemplate(route), status, elapsed_ms: Math.max(0, Math.round(performance.now() - startedAt)), request_id: requestId };
  console.info('[buddy.diagnostic]', details);
}

export async function fetchApi(path: string, init: RequestInit = {}, operation?: string): Promise<Response> {
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  const startedAt = performance.now();
  const requestId = newRequestId();
  const headers = new Headers(init.headers);
  headers.set('X-Request-ID', requestId);
  const route = routeTemplate(path);
  const method = (init.method || 'GET').toUpperCase();
  const op = operation || `${method.toLowerCase()} ${route}`;
  try {
    const response = await fetch(`${base}${path}`, { ...init, headers });
    const responseRequestId = response.headers.get('X-Request-ID') || requestId;
    logClientDiagnostic(op, path, response.status, startedAt, responseRequestId);
    return response;
  } catch (error) {
    logClientDiagnostic(op, path, 'network_error', startedAt, requestId);
    throw error;
  }
}
