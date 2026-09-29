import MainContent from '@/components/MainContent';
import DashboardWorkspace from './components/DashboardWorkspace';

export const metadata = {
  title: 'ภาพรวม',
  description: 'สรุปการกระทบยอดรายเดือน เลือกได้ว่าจะแสดงส่วนไหนบ้าง',
};

export default function DashboardPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <MainContent>
        <DashboardWorkspace />
      </MainContent>
    </div>
  );
}
