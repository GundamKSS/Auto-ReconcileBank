import MainContent from "../../../components/MainContent";
import MasterBankStatement from "./components/MasterBankStatement";

export const metadata = {
  title: "Master Data · Bank Statement",
  description: "จัดการข้อมูล Bank Statement ที่นำเข้าไว้",
};

export default function MasterBankStatementPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <MainContent>
        <MasterBankStatement />
      </MainContent>
    </div>
  );
}