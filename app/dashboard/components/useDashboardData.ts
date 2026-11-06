'use client';

import { startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import type { DashboardData } from './shared';

type Loaded<T> = { key: string; value: T | null; error: string; updatedAt: Date };
type TrendData = Pick<DashboardData, 'trend' | 'side'>;

async function fetchSection<T>(params: string, section: 'overview' | 'trend', signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/dashboard/summary?${params}&section=${section}`, { signal, cache: 'no-store' });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
  return payload as T;
}

/** โหลดงวดปัจจุบันก่อน แล้วค่อยเริ่ม query ย้อนหลัง เพื่อให้สรุปใช้งานได้ระหว่างรอกราฟ */
export default function useDashboardData({
  params, ready, revision, historyMonths,
}: {
  params: string;
  ready: boolean;
  revision: number;
  /** 0 = ไม่ใช้ข้อมูลย้อนหลัง, 2 = เทียบเดือนก่อน, 6/12 = กราฟย้อนหลัง */
  historyMonths: 0 | 2 | 6 | 12;
}) {
  const [overview, setOverview] = useState<Loaded<DashboardData> | null>(null);
  const [history, setHistory] = useState<Loaded<TrendData> | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const overviewKey = JSON.stringify([params, revision]);
  const historyKey = JSON.stringify([overviewKey, historyMonths, historyRevision]);
  const loading = !ready || overview?.key !== overviewKey;
  const overviewReady = !loading && Boolean(overview?.value);
  const overviewSide = overview?.value?.side;
  const loadedHistoryKey = history?.key;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    fetchSection<DashboardData>(params, 'overview', controller.signal).then((value) => {
      if (!controller.signal.aborted) setOverview({ key: overviewKey, value, error: '', updatedAt: new Date() });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setOverview({ key: overviewKey, value: null,
        error: error instanceof Error ? error.message : 'โหลดข้อมูลสรุปไม่สำเร็จ', updatedAt: new Date() });
    });
    return () => controller.abort();
  }, [params, ready, overviewKey]);

  // ไม่เริ่มงานย้อนหลังแย่งฐานข้อมูล ก่อนข้อมูลด้านบนพร้อม และไม่โหลดเมื่อปิดทั้ง KPI กับกราฟ
  useEffect(() => {
    if (!overviewReady || historyMonths === 0 || loadedHistoryKey === historyKey) return;
    const controller = new AbortController();
    const query = new URLSearchParams(params);
    query.set('trendMonths', String(historyMonths));
    if (overviewSide) query.set('side', overviewSide);
    fetchSection<TrendData>(query.toString(), 'trend', controller.signal).then((value) => {
      if (value.side !== overviewSide) throw new Error('สิทธิ์การดูข้อมูลเปลี่ยนแล้ว กรุณาโหลดสรุปใหม่อีกครั้ง');
      if (!controller.signal.aborted) startTransition(() => setHistory({ key: historyKey, value, error: '', updatedAt: new Date() }));
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setHistory({ key: historyKey, value: null,
        error: error instanceof Error ? error.message : 'โหลดข้อมูลย้อนหลังไม่สำเร็จ', updatedAt: new Date() });
    });
    return () => controller.abort();
  }, [params, overviewReady, overviewSide, historyMonths, historyKey, loadedHistoryKey]);

  const data = useMemo(() => {
    if (!overview?.value) return null;
    // ไม่ผสมกราฟจากเดือน/ตัวกรองเก่ากับยอดสรุปใหม่ และไม่ผสมข้อมูลเมื่อสิทธิ์เปลี่ยนระหว่างโหลด
    const trend = !loading && historyMonths > 0 && history?.key === historyKey && history.value?.side === overview.value.side
      ? history.value.trend : [];
    return { ...overview.value, trend, trendMonths: historyMonths || 6 };
  }, [overview, history, historyKey, historyMonths, loading]);

  const retryHistory = useCallback(() => setHistoryRevision((value) => value + 1), []);
  return {
    data,
    loading,
    error: overview?.key === overviewKey ? overview.error : '',
    updatedAt: overview?.value ? overview.updatedAt : null,
    historyLoading: overviewReady && historyMonths > 0 && history?.key !== historyKey,
    historyError: history?.key === historyKey ? history.error : '',
    retryHistory,
  };
}
