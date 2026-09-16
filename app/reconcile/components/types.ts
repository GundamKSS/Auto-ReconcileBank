export type ReconcileSession = {
  bankCode: string;
  // บัญชีที่กำลังกระทบยอด — null แปลว่า session เก่าที่บันทึกไว้ก่อนระบบแยกตามบัญชี
  // หรือยังไม่ได้รัน sql/006 ทั้งสองกรณีระบบถอยไปทำงานทั้งธนาคารแบบเดิม
  bankAccountNo: string | null;
  // ชื่อบัญชีเต็มไว้โชว์บนหัวตาราง เก็บลง localStorage ไปด้วยจะได้ไม่ต้องรอ API ตอนเปิดหน้า
  accountName: string | null;
  importId: number | null;
  fileName: string | null;
  periodStart: string; // 'YYYY-MM-DD'
  periodEnd: string;
  includeSuspenseBuffer: boolean;
};

export type BankStatementImportSummary = {
  ImportId: number;
  BankCode: string;
  BankAccountNo: string | null;
  FileName: string;
  PeriodStart: string;
  PeriodEnd: string;
  ImportedRowCount: number;
  ImportedAt: string;
};
