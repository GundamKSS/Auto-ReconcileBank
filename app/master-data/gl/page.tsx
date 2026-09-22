import MainContent from "../../../components/MainContent";
import MasterGl from "./components/MasterGl";

export const metadata = {
  title: "Master Data · GL",
  description: "รายการ GL (BC365) ของบัญชีธนาคาร",
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
