import MainContent from "../../components/MainContent";
import ReportWorkspace from "./components/ReportWorkspace";

export const metadata = {
  title: "Reports",
  description: "สรุปการกระทบยอดประจำเดือน พร้อม export เป็น Excel",
};

export default function ReportsPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <MainContent>
        <ReportWorkspace />
      </MainContent>
    </div>
  );
}
