"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type FirstPage = Record<string, unknown>;

function withOffset(url: string, offset: number) {
  return `${url}${url.includes("?") ? "&" : "?"}offset=${offset}`;
}

/**
 * โหลดรายการแบบ offset ทีละหน้า (หน้าละ 50 ตามที่ API กำหนด) ตามแพทเทิร์นของหน้า Match History/Reports
 * - url เปลี่ยน (ตัวกรองเปลี่ยน) = โหลดหน้าแรกใหม่ ทิ้งผลของ request เก่าที่ตอบกลับมาทีหลัง
 * - firstPage คือ JSON ของหน้าแรกทั้งก้อน ไว้หยิบค่าที่ API ส่งมาเฉพาะหน้าแรก (total, summary, ตัวเลือก dropdown)
 * - url เป็น null = ยังไม่พร้อมโหลด (เช่นยังไม่รู้ธนาคาร)
 */
export function useOffsetList<T>(url: string | null, itemsKey: string) {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [firstPage, setFirstPage] = useState<FirstPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const requestIdRef = useRef(0);
  // กันยิงซ้ำในเฟรมเดียวกัน — state loadingMore อัปเดตแบบ async เลยเช็คไม่ทันถ้ามีสองสัญญาณมาพร้อมกัน
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (url === null) return;
    const reqId = ++requestIdRef.current;
    let cancelled = false;

    async function loadFirstPage(target: string) {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(withOffset(target, 0));
        const data = await res.json();
        if (cancelled || reqId !== requestIdRef.current) return;
        if (!res.ok) {
          setError(data.error || "โหลดข้อมูลไม่สำเร็จ");
          setItems([]);
          setTotal(0);
          setFirstPage(null);
          return;
        }
        const list = (data[itemsKey] ?? []) as T[];
        setItems(list);
        setTotal(Number(data.total ?? list.length));
        setFirstPage(data);
      } catch {
        if (!cancelled && reqId === requestIdRef.current) {
          setError("เชื่อมต่อ server ไม่ได้");
          setItems([]);
          setTotal(0);
          setFirstPage(null);
        }
      } finally {
        if (!cancelled && reqId === requestIdRef.current) setLoading(false);
      }
    }

    loadFirstPage(url);
    return () => {
      cancelled = true;
    };
  }, [url, itemsKey]);

  const hasMore = items.length < total;

  const loadMore = useCallback(async () => {
    if (url === null || loading || inFlightRef.current || !hasMore) return;
    const reqId = requestIdRef.current;
    inFlightRef.current = true;
    setLoadingMore(true);
    try {
      const res = await fetch(withOffset(url, items.length));
      const data = await res.json();
      // ตัวกรองเปลี่ยนระหว่างรอ response — ทิ้งผลลัพธ์ชุดนี้ไป ไม่งั้นแถวจะปนกันคนละตัวกรอง
      if (reqId !== requestIdRef.current) return;
      if (!res.ok) {
        setError(data.error || "โหลดเพิ่มไม่สำเร็จ");
        return;
      }
      setItems((prev) => [...prev, ...((data[itemsKey] ?? []) as T[])]);
    } catch {
      if (reqId === requestIdRef.current) setError("เชื่อมต่อ server ไม่ได้");
    } finally {
      inFlightRef.current = false;
      if (reqId === requestIdRef.current) setLoadingMore(false);
    }
  }, [url, itemsKey, loading, hasMore, items.length]);

  return { items, total, firstPage, loading, loadingMore, error, hasMore, loadMore };
}

/** infinite scroll: เรียก loadMore เมื่อ sentinel ท้ายรายการใกล้เข้ามาในจอ */
export function useInfiniteScroll(sentinel: HTMLElement | null, hasMore: boolean, loadMore: () => void) {
  useEffect(() => {
    if (!sentinel || !hasMore) return;

    const nearViewport = () => sentinel.getBoundingClientRect().top < window.innerHeight + 300;
    // อ่าน layout แค่เฟรมละครั้ง — scroll event ยิงถี่กว่าเฟรม ถ้าเรียก getBoundingClientRect ทุกครั้งจะบังคับ reflow ซ้ำจนเลื่อนกระตุก
    let frame = 0;
    const check = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (nearViewport()) loadMore();
      });
    };

    const io = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) loadMore();
    });
    io.observe(sentinel);
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    check();

    return () => {
      io.disconnect();
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
      cancelAnimationFrame(frame);
    };
  }, [sentinel, hasMore, loadMore]);
}
