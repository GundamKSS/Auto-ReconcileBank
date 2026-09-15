import { ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { Direction } from './shared';

/**
 * ป้ายบอกว่ายอดเงินมาจากฝั่งไหน — สีเดียวกับ SourceTag ในหน้า Suspense (Bank = ฟ้า, BC = ม่วงอ่อน)
 * ใส่ normal-case ไว้เพราะมักถูกวางในหัวข้อที่เป็น uppercase ซึ่งจะทำให้ "Bank" กลายเป็น "BANK"
 */
export function SourceTag({ source }: { source: 'BANK' | 'GL' }) {
  const isBank = source === 'BANK';
  return (
    <span
      title={isBank ? 'Bank Statement' : 'BC365'}
      className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal ${
        isBank ? 'bg-sky-100 text-sky-700' : 'bg-violet-100 text-violet-700'
      }`}
    >
      {isBank ? 'Bank' : 'BC'}
    </span>
  );
}

/** ป้ายทิศทางเงินเป็นข้อความ — สีเดียวกับ DirectionBadge ในหน้า Reports (เข้า = ม่วง, ออก = แดง) */
export function DirectionTag({ direction }: { direction: Direction }) {
  const isIn = direction === 'IN';
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
        isIn ? 'bg-purple-50 text-purple-700' : 'bg-red-50 text-red-600'
      }`}
    >
      {isIn ? <ArrowDownLeft size={10} /> : <ArrowUpRight size={10} />}
      {isIn ? 'เงินเข้า' : 'เงินออก'}
    </span>
  );
}
