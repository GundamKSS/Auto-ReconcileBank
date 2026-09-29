import MainContent from "../../../components/MainContent";
import MatchHistoryWorkspace from "./components/MatchHistoryWorkspace";

export const metadata = {
  title: "ประวัติการจับคู่",
  description: "ตรวจสอบประวัติการจับคู่และคืนรายการเพื่อแก้ไขการจับคู่",
};

export default function ReconcileHistoryPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <MainContent>
        <MatchHistoryWorkspace />
      </MainContent>
    </div>
  );
}
