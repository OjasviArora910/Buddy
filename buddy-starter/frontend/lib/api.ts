export async function fetchApi(path: string, init?: RequestInit): Promise<Response> {
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';
  return fetch(`${base}${path}`, init);
}
