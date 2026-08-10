type StatCardProps = {
  title: string;
  value: string;
  change: string;
  positive?: boolean;
};

export default function StatCard({
  title,
  value,
  change,
  positive = true,
}: StatCardProps) {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)] transition duration-300 hover:-translate-y-1 hover:shadow-[0_15px_40px_rgba(30,64,175,0.1)]">

      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </p>

      <div className="mt-5 flex items-center justify-between gap-3">

        <h3 className="text-4xl font-bold tracking-tight text-slate-900">
          {value}
        </h3>

        <span
          className={`
            rounded-full px-3 py-1 text-sm font-semibold
            ${
              positive
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-600'
            }
          `}
        >
          {change}
        </span>

      </div>

      <p className="mt-2 text-sm text-slate-500">
        vs. previous month
      </p>

    </div>
  );
}