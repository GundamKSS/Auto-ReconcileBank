import MainContent from "../../../components/MainContent";
import MasterBankAccounts from "./components/MasterBankAccounts";

export const metadata = {
  title: "จัดการข้อมูล · บัญชีธนาคาร",
  description: "เพิ่มบัญชีธนาคารใหม่และเปิด/ปิดบัญชีสำหรับการนำเข้า statement",
};

export default function MasterBankAccountsPage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <MainContent>
        <MasterBankAccounts />
      </MainContent>
    </div>
  );
}
