import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authFetch, authFetchJson } from './client';

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string): string | null => store.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      store.set(key, String(value));
    },
    removeItem: (key: string): void => {
      store.delete(key);
    },
    clear: (): void => {
      store.clear();
    },
  });
  vi.stubGlobal('window', { location: { href: '' } });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('authFetch', () => {
  it('sets an Authorization Bearer header when a token is stored', async () => {
    localStorage.setItem('auth_token', 'abc123');
    fetchMock.mockResolvedValue(new Response('ok'));
    await authFetch('/api/test');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer abc123');
  });

  it('sends no Authorization header when there is no token', async () => {
    fetchMock.mockResolvedValue(new Response('ok'));
    await authFetch('/api/test');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/test');
    expect((init.headers as Headers).get('Authorization')).toBeNull();
  });
});

describe('authFetchJson', () => {
  it('resolves with the parsed JSON body on a 200 response', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ hello: 'world' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const data = await authFetchJson<{ hello: string }>('/api/test');
    expect(data).toEqual({ hello: 'world' });
  });

  it('throws with the response text on a non-OK status', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    await expect(authFetchJson('/api/test')).rejects.toThrow('boom');
  });

  it('on 401 removes auth_token from localStorage and rejects', async () => {
    localStorage.setItem('auth_token', 'stale');
    fetchMock.mockResolvedValue(new Response('unauthorized', { status: 401 }));
    await expect(authFetchJson('/api/test')).rejects.toThrow('Session expired');
    expect(localStorage.getItem('auth_token')).toBeNull();
    expect(window.location.href).toBe('/');
  });
});
