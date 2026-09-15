import MainContent from "../../../components/MainContent";
import MatchHistoryWorkspace from "./components/MatchHistoryWorkspace";

export const metadata = {
  title: "Match History",
  description: "ประวัติการจับคู่ทั้งหมด และยกเลิกการจับคู่ (Unmatch) กรณีแมชผิด",
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
