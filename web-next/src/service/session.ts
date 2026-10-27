import axios from 'axios';

const AUTH_STORAGE_KEY = 'auth-storage';
const REFRESH_CHANNEL_NAME = 'auth-refresh';
const API_BASE_URL = (import.meta.env.VITE_SERVICE_BASE_URL || '/api/v1').replace(/\/$/, '');

export interface LegacyUser {
  id?: string;
  username?: string;
  name?: string;
  role?: string;
  permissions?: string[];
  dataScope?: string;
}

export interface LegacySession {
  user: LegacyUser;
  accessToken: string;
  refreshToken: string;
}

type SessionListener = (session: LegacySession | null) => void;

const listeners = new Set<SessionListener>();

const refreshChannel =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(REFRESH_CHANNEL_NAME);

let current = readLegacySession();

function readLegacySession(): LegacySession | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as {
      state?: {
        user?: LegacyUser;
        accessToken?: string | null;
        refreshToken?: string | null;
        isAuthenticated?: boolean;
      };
    };
    const state = parsed.state;
    if (!state?.accessToken || !state?.refreshToken) return null;
    if (state.isAuthenticated === false) return null;

    return {
      user: state.user ?? {},
      accessToken: state.accessToken,
      refreshToken: state.refreshToken
    };
  } catch {
    return null;
  }
}

function emit() {
  listeners.forEach(listener => listener(current));
}

function persistTokens(accessToken: string, refreshToken: string) {
  const raw = localStorage.getItem(AUTH_STORAGE_KEY);
  let parsed: { state?: Record<string, unknown>; [key: string]: unknown } = { state: {}, version: 0 };

  if (raw) {
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      parsed = { state: {}, version: 0 };
    }
  }

  const previousUser = parsed.state?.user ?? current?.user ?? null;
  const next = {
    ...parsed,
    state: {
      ...parsed.state,
      user: previousUser,
      accessToken,
      refreshToken,
      isAuthenticated: true
    }
  };

  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
  current = readLegacySession();
  emit();
}

if (refreshChannel) {
  refreshChannel.addEventListener('message', event => {
    const data = event.data as { accessToken?: string; refreshToken?: string } | null;
    if (!data?.accessToken || !data?.refreshToken) return;
    if (current?.refreshToken === data.refreshToken) return;

    persistTokens(data.accessToken, data.refreshToken);
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== AUTH_STORAGE_KEY) return;
    current = readLegacySession();
    emit();
  });
}

export function getSession(): LegacySession | null {
  current = readLegacySession();
  return current;
}

export function getPermissions(): string[] {
  return getSession()?.user.permissions ?? [];
}

export function onSessionChange(listener: SessionListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function redirectToLegacyLogin() {
  const returnPath = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?redirect=${encodeURIComponent(returnPath)}`);
}

let refreshInFlight: Promise<boolean> | null = null;

/** 刷新令牌轮转：单飞并在标签页之间广播，避免同一 refresh token 被并发消费。 */
export function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;

  const session = getSession();
  if (!session) return Promise.resolve(false);

  const previousRefreshToken = session.refreshToken;

  refreshInFlight = (async () => {
    try {
      const response = await axios.post(
        `${API_BASE_URL}/auth/refresh`,
        { refreshToken: previousRefreshToken },
        { timeout: 15000 }
      );
      const payload = response.data as {
        code?: number;
        data?: { accessToken?: string; refreshToken?: string };
      };

      if (
        payload?.code !== 0 ||
        !payload.data?.accessToken ||
        !payload.data.refreshToken
      ) {
        return false;
      }

      persistTokens(payload.data.accessToken, payload.data.refreshToken);
      refreshChannel?.postMessage({
        accessToken: payload.data.accessToken,
        refreshToken: payload.data.refreshToken
      });

      return true;
    } catch {
      // 另一标签页可能已完成轮转，稍后读取共享存储再判断。
      await new Promise(resolve => setTimeout(resolve, 350));
      const latest = getSession();
      return Boolean(latest && latest.refreshToken !== previousRefreshToken);
    } finally {
      setTimeout(() => {
        refreshInFlight = null;
      }, 500);
    }
  })();

  return refreshInFlight;
}
