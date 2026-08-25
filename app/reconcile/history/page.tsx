import Sidebar from "../../../components/Sidebar";
import MainContent from "../../../components/MainContent";
import MatchHistoryWorkspace from "./components/MatchHistoryWorkspace";

export const metadata = {
  title: "Match History | Auto Recon 365",
  description: "ประวัติการจับคู่ทั้งหมด และยกเลิกการจับคู่ (Unmatch) กรณีแมชผิด",
};

export default function ReconcileHistoryPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <Sidebar />
      <MainContent>
        <MatchHistoryWorkspace />
      </MainContent>
    </div>
  );
}
