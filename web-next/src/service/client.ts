import axios, { AxiosHeaders, type AxiosRequestConfig, type RawAxiosHeaders } from 'axios';
import { getSession, redirectToLegacyLogin, refreshSession } from './session';

const API_BASE_URL = (import.meta.env.VITE_SERVICE_BASE_URL || '/api/v1').replace(/\/$/, '');
const AUTH_PATHS = ['/auth/login', '/auth/refresh', '/auth/auto-login'];

interface ApiEnvelope<T> {
  code: number;
  data: T;
  message?: string;
  msg?: string;
}

function isAuthPath(url?: string) {
  return Boolean(url && AUTH_PATHS.some(path => url.startsWith(path)));
}

function readErrorMessage(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error.message : '请求失败';
  }

  const payload = error.response?.data as { message?: string; msg?: string } | undefined;
  return payload?.message || payload?.msg || error.message || '网络连接异常';
}

export async function apiRequest<T>(
  config: AxiosRequestConfig,
  retried = false
): Promise<T> {
  const session = getSession();
  const headers = new AxiosHeaders(config.headers as RawAxiosHeaders | undefined);

  if (session?.accessToken) {
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  }

  try {
    const response = await axios.request<ApiEnvelope<T>>({
      ...config,
      baseURL: API_BASE_URL,
      headers,
      timeout: 20000
    });
    const payload = response.data;

    if (payload.code !== 0) {
      throw new Error(payload.message || payload.msg || '请求失败');
    }

    return payload.data;
  } catch (error) {
    const status = axios.isAxiosError(error) ? error.response?.status : undefined;

    if (status === 401 && !retried && !isAuthPath(config.url)) {
      const refreshed = await refreshSession();
      if (refreshed) return apiRequest<T>(config, true);

      redirectToLegacyLogin();
    }

    throw new Error(readErrorMessage(error));
  }
}

export function apiGet<T>(url: string, params?: Record<string, unknown>) {
  return apiRequest<T>({ url, method: 'GET', params });
}

export function apiPatch<T>(url: string, data: unknown) {
  return apiRequest<T>({ url, method: 'PATCH', data });
}
