// app/Import/page.tsx
import React from "react";
import MainContent from "../../components/MainContent";
import ImportFlow from "./components/ImportFlow";

// 1. ตั้งค่า Metadata สำหรับชื่อแท็บ (ทำได้เฉพาะใน Server Component)
export const metadata = {
  title: "นำเข้าข้อมูล",
  description: "นำเข้าไฟล์รายการเดินบัญชีธนาคาร หรือดึงข้อมูลบัญชีจาก BC365",
};

// 2. Main Component
export default function ImportPage() {
  return (
    // เป็น Container หลักที่ครอบคอมโพเนนต์ ImportFlow เอาไว้
    // <div className="w-full min-h-screen bg-slate-50">
    <div className="min-h-screen bg-[#f8fafc]">
          <MainContent>
            <ImportFlow />
          </MainContent>

    </div>
  );
}
