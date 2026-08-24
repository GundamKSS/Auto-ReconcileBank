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
      className={`rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)] ${className}`}
    >
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold text-slate-900">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
