import MainContent from "../../components/MainContent";
import SuspenseWorkspace from "./components/SuspenseWorkspace";

export const metadata = {
  title: "Suspense",
  description: "รายการที่พักไว้ (Suspense) รอดึงกลับไปจับคู่ใหม่",
};

export default function SuspensePage() {
  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <MainContent>
        <SuspenseWorkspace />
      </MainContent>
    </div>
  );
}
