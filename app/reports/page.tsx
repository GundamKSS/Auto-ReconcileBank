import Sidebar from "../../components/Sidebar";
import MainContent from "../../components/MainContent";
import ReportWorkspace from "./components/ReportWorkspace";

export const metadata = {
  title: "Reports | Auto Recon 365",
  description: "สรุปการกระทบยอดประจำเดือน พร้อม export เป็น Excel",
};

export default function ReportsPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <Sidebar />
      <MainContent>
        <ReportWorkspace />
      </MainContent>
    </div>
  );
}
