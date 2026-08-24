type StatCardProps = {
  title: string;
  value: string;
  sub?: string;
  /** ส่วนต่างเทียบเดือนก่อน — null เมื่อไม่มีข้อมูลเดือนก่อนให้เทียบ */
  delta?: number | null;
  /** หน่วยของ delta: 'pct' = จุดเปอร์เซ็นต์, 'rel' = เปลี่ยนแปลงกี่ % */
  deltaUnit?: 'pct' | 'rel';
  /**
   * ตัวเลขเพิ่มขึ้นถือเป็นเรื่องดีไหม (เช่น "ยังไม่จับคู่" เพิ่มขึ้น = ไม่ดี)
   * ใส่ 'neutral' เมื่อขึ้นหรือลงก็ไม่ได้แปลว่าดีหรือแย่ เช่นปริมาณรายการทั้งเดือน
   */
  higherIsBetter?: boolean | 'neutral';
  tone?: 'default' | 'good' | 'bad';
};

export default function StatCard({
  title,
  value,
  sub,
  delta = null,
  deltaUnit = 'rel',
  higherIsBetter = true,
  tone = 'default',
}: StatCardProps) {
  const valueColor = tone === 'good' ? 'text-emerald-600' : tone === 'bad' ? 'text-rose-600' : 'text-slate-900';

  // ต่ำกว่า 0.05 ถือว่าไม่ขยับ — กันลูกศรกระพริบจากเศษทศนิยม
  const flat = delta === null || Math.abs(delta) < 0.05;
  const neutral = higherIsBetter === 'neutral';
  const positive = flat ? true : delta! > 0 === higherIsBetter;
  const deltaText = flat
    ? 'เท่าเดิม'
    : `${delta! > 0 ? '↗ +' : '↘ '}${delta!.toFixed(1)}${deltaUnit === 'pct' ? ' pp' : '%'}`;

  return (
    <div className="rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(30,64,175,0.1)]">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{title}</p>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className={`text-3xl font-bold tabular-nums tracking-tight ${valueColor}`}>{value}</h3>

        {delta !== null && (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              flat || neutral
                ? 'bg-slate-100 text-slate-500'
                : positive
                  ? 'bg-emerald-50 text-emerald-700'
                  : 'bg-rose-50 text-rose-600'
            }`}
          >
            {deltaText}
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-slate-500">{sub ?? (delta !== null ? 'เทียบกับเดือนก่อน' : ' ')}</p>
    </div>
  );
}
