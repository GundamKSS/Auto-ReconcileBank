import Sidebar from "../../components/Sidebar";
import MainContent from "../../components/MainContent";
import SuspenseWorkspace from "./components/SuspenseWorkspace";

export const metadata = {
  title: "Suspense | Auto Recon 365",
  description: "รายการที่พักไว้ (Suspense) รอดึงกลับไปจับคู่ใหม่",
};

export default function SuspensePage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <Sidebar />
      <MainContent>
        <SuspenseWorkspace />
      </MainContent>
    </div>
  );
}
