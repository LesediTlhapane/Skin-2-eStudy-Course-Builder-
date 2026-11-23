export async function parseApiJson<T = any>(res: Response): Promise<T> {
  const rawText = await res.text();
  const trimmed = rawText.trim();
  if (!trimmed) {
    if (!res.ok) {
      throw new Error(`Request failed with HTTP ${res.status} (${res.statusText || 'Empty response'}).`);
    }
    return {} as T;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const preview = trimmed.replace(/\s+/g, ' ').slice(0, 140);
    throw new Error(
      `API endpoint returned HTTP ${res.status} non-JSON response ("${preview}"). Verify backend API routes are running.`
    );
  }
}
