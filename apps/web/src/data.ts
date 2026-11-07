import { QueryClient, useQuery } from '@tanstack/react-query';
import type { Campaign, Contact, CallResult, Row } from '../../../packages/shared/src/index.js';
import { api } from './api.js';
export const query = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
export type CampaignRow = Row<Campaign & { status: string }>;
export type ContactRow = Row<
  Contact & { campaign_id: string; status: string; blocked_reason?: string }
>;
export type ResultRow = Row<CallResult & { call_id?: string }>;
export type CallRow = Row<{
  campaign_id: string;
  contact_id?: string;
  status: string;
  sample: boolean;
  simulation: boolean;
  last_status: string;
}>;
export type DeliveryRow = Row<{
  result_id: string;
  destination_id: string;
  status: string;
  attempts: number;
  error?: string;
}>;
export type DestinationRow = Row<{ name: string; kind: 'webhook'; url: string; enabled: boolean }>;
export interface Providers {
  simulation: boolean;
  dialogue: string;
  services: { name: string; status: string }[];
}
export function useData<T>(path: string, enabled = true) {
  return useQuery<T>({
    queryKey: [path],
    queryFn: () => api<T>(path),
    enabled,
    staleTime: 15000,
    refetchInterval: 30000,
  });
}
export async function change<T = unknown>(
  path: string,
  method = 'POST',
  body?: unknown,
): Promise<T> {
  const result = await api<T>(path, method, body);
  await query.invalidateQueries({ queryKey: [`/${path.split('/')[1]}`] });
  if (path.startsWith('/destinations/') && path.endsWith('/test'))
    await query.invalidateQueries({ queryKey: ['/deliveries'] });
  return result;
}
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
export function refreshResults() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    for (const path of ['/results', '/calls', '/contacts', '/campaigns', '/deliveries'])
      void query.invalidateQueries({ queryKey: [path] });
  }, 300);
}
export const maskPhone = (s = '') => s.replace(/\d(?=\d{4})/g, '•');
export const friendly = (s: string) =>
  s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
export const dateLabel = (s: string) =>
  new Date(s).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
export function getContact(result: ResultRow, contacts: ContactRow[]) {
  return contacts.find((c) => c.id === result.data.contact_id);
}
export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeLocal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
