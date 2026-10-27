import { apiGet, apiPatch } from '../client';

export interface MetricsGroup {
  monthBudget: number | null;
  monthActual: number;
  monthYoy: number;
  monthMom: number;
  monthRate: number | null;
  ytdBudget: number | null;
  ytdActual: number;
  ytdYoy: number;
  annualBudget: number | null;
  annualRate: number | null;
}

export interface KeyMetricsRow {
  key: string;
  label: string;
  category: string;
  valueType: 'amount' | 'quantity' | 'ratio';
  values: MetricsGroup;
}

export interface KeyMetricsResponse {
  period: string;
  rows: KeyMetricsRow[];
  companyCode: string | null;
  companyName: string | null;
  companyType: 'single' | 'summary' | null;
  degraded: boolean;
}

export interface ProductCategory {
  id: string;
  code: string;
  name: string;
  subjectKeyword: string;
  subjectCodes: string[];
  sortOrder: number;
  status: 'active' | 'inactive';
}

export interface ProfileUser {
  id: string;
  username: string;
  name: string;
  permissions?: string[];
  role: string;
}

export function fetchKeyMetrics(params: { period?: string; companyCode?: string }) {
  return apiGet<KeyMetricsResponse>('/dashboard/analysis/key-metrics', params);
}

export function fetchProductCategories() {
  return apiGet<ProductCategory[]>('/data/product-categories');
}

export function updateProductCategory(
  id: string,
  input: Partial<Pick<ProductCategory, 'name' | 'subjectKeyword' | 'subjectCodes' | 'sortOrder' | 'status'>>
) {
  return apiPatch<ProductCategory>(`/data/product-categories/${id}`, input);
}

export function fetchProfile() {
  return apiGet<ProfileUser>('/auth/profile');
}
