import HelpTooltip from '../../../components/HelpTooltip';
import type { ReactNode } from 'react';

/** กรอบการ์ดมาตรฐานของหน้า Dashboard — คุมหัวข้อ/คำอธิบาย/มุมขวาให้เหมือนกันทุกส่วน */
export default function Card({
  title,
  subtitle,
  action,
  children,
  className = '',
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`dashboard-card-enter min-w-0 rounded-[20px] border border-white/80 bg-white p-4 shadow-[0_10px_35px_rgba(30,64,175,0.06)] sm:p-6 ${className}`}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="text-lg font-bold text-slate-900">{title}</h2>
            {subtitle && <HelpTooltip label={`เกี่ยวกับ${title}`}>{subtitle}</HelpTooltip>}
          </div>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
