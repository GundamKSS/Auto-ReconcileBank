import MainContent from "../../../components/MainContent";
import MasterGl from "./components/MasterGl";

export const metadata = {
  title: "จัดการข้อมูล · รายการบัญชี BC365",
  description: "ตรวจสอบรายการบัญชีธนาคารจาก BC365",
};

export default function MasterGlPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <MainContent>
        <MasterGl />
      </MainContent>
    </div>
  );
}
