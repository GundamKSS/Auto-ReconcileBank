import MainContent from "../../components/MainContent";
import ReconcileWorkspace from "./components/ReconcileWorkspace";

export const metadata = {
  title: "กระทบยอด",
  description: "เปรียบเทียบและจับคู่รายการธนาคารกับรายการบัญชีใน BC365",
};

export default function ReconcilePage() {
  return (
      <div className="lg:h-screen lg:overflow-hidden bg-[#f8fafc]">
                 <MainContent className="flex bg-gray-50 lg:h-screen lg:overflow-hidden">
                   <ReconcileWorkspace />
              </MainContent>
      </div>
  );
}
