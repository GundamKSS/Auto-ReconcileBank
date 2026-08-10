export type ReconcileSession = {
  bankCode: string;
  importId: number | null;
  fileName: string | null;
  periodStart: string; // 'YYYY-MM-DD'
  periodEnd: string;
  includeSuspenseBuffer: boolean;
};

export type BankStatementImportSummary = {
  ImportId: number;
  BankCode: string;
  FileName: string;
  PeriodStart: string;
  PeriodEnd: string;
  ImportedRowCount: number;
  ImportedAt: string;
};