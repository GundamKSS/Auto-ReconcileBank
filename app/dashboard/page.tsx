import Sidebar from '@/components/Sidebar';
import MainContent from '@/components/MainContent';
import DashboardHeader from './components/DashboardHeader';
import StatCard from './components/StatCard';
import ReconciliationChart from './components/ReconciliationChart';
import StatusBreakdown from './components/StatusBreakdown';

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">

      {/* Sidebar */}
      <Sidebar />

      {/* Main */}
      <MainContent>

        <DashboardHeader />

        <main className="p-8">

          {/* Page Title */}
          <div className="mb-7">

            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Dashboard
            </h1>

            <p className="mt-1 text-[16px] text-slate-500">
              Live overview · updated a moment ago
            </p>

          </div>

          {/* Stats */}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">

            <StatCard
              title="Total Transactions"
              value="48,231"
              change="↗ +4.2%"
            />

            <StatCard
              title="Matched"
              value="45,918"
              change="↗ +3.1%"
            />

            <StatCard
              title="Unmatched"
              value="20,009"
              change="↘ -1.8%"
              positive={false}
            />

            <StatCard
              title="Reconciliation Rate"
              value="95.2%"
              change="↗ +0.6%"
            />

          </div>

          {/* Charts */}
          <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-[1.8fr_0.9fr]">

            {/* Activity */}
            <section className="rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">

              <div className="mb-5 flex items-start justify-between">

                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    Reconciliation activity
                  </h2>

                  <p className="mt-1 text-sm text-slate-500">
                    Last 30 days · matched vs unmatched
                  </p>
                </div>

                <div className="flex gap-4 text-sm">

                  <span className="flex items-center gap-2 text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full bg-sky-500" />
                    Matched
                  </span>

                  <span className="flex items-center gap-2 text-slate-600">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                    Unmatched
                  </span>

                </div>

              </div>

              <ReconciliationChart />

            </section>

            {/* Status */}
            <section className="rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">

              <div className="mb-4">

                <h2 className="text-lg font-bold text-slate-900">
                  Status breakdown
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Current month
                </p>

              </div>

              <StatusBreakdown />

            </section>

          </div>

          {/* Recent Transactions */}
          <section className="mt-6 rounded-[20px] border border-white/80 bg-white p-6 shadow-[0_10px_35px_rgba(30,64,175,0.06)]">

            <div className="flex items-center justify-between">

              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  Recent transactions
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Latest bank entries awaiting or completing match
                </p>
              </div>

              <button className="text-sm font-semibold text-blue-600 hover:text-blue-700">
                View all →
              </button>

            </div>

          </section>

        </main>

      </MainContent>

    </div>
  );
}