# Architecture Reference: Auto Reconcile Bank

This document outlines the detailed architecture, database design, external integrations, and security models of the TRW Auto Reconcile Bank application.

---

## 1. System Components & Flow

```
┌────────────────────────────────────────────────────────┐
│                   Web Browser Client                   │
│   (Next.js React 19 Frontend + Tailwind CSS v4)        │
└──────────────────────────┬─────────────────────────────┘
                           │ HTTP / JSON API
                           ▼
┌────────────────────────────────────────────────────────┐
│                 Next.js Server Backend                 │
│  - Session & Role Guards (lib/session.ts, roles.ts)   │
│  - Matching Engine & Assistant (lib/matchAssistant.ts) │
│  - Bank Statement Parsers (lib/bankParsers/)          │
│  - Period Lock & Approval (lib/periodWorkflow.ts)     │
└──────────────┬─────────────────────────┬───────────────┘
               │                         │
               ▼                         ▼
┌──────────────────────────────┐  ┌───────────────────────────────────┐
│     SQL Server Database      │  │     TRW Data Center Services      │
│      [Reconcile_Bank]        │  │     (http://192.168.2.109:8000)   │
│ - BankStatementImport/Line   │  │                                   │
│ - BankAccountLedgerEntries   │  │  - /auth/auth_permission_prog     │
│ - ReconciliationMatch/Line   │  │  - /sync/BankAccountLedgerEntries │
│ - ReconciliationPeriodClose  │  │  - /sync/BankAccount...40days     │
│ - ReconciliationWorkApproval │  └───────────────────────────────────┘
│ - ReconciliationEmployeeRole │
└──────────────────────────────┘
```

---

## 2. Database Schema & Tables

All tables reside in the `Reconcile_Bank` database on SQL Server.

### A. Bank Account Master (`BankAccountMapping`)
- `BankAccountNo` (NVARCHAR(50), PK): BC365 account code (e.g. `TW_SCB_C1`).
- `BankCode` (NVARCHAR(10)): `KBANK`, `SCB`, `BBL`, etc.
- `AccountName` (NVARCHAR(200)): Display name with `#displayNo` appended.
- `IsActive` (BIT, added in migration `012`): Whether the account is active. Inactive accounts reject new imports.
- `CreatedBy`, `StatusChangedAt`, `StatusChangedBy`: Audit columns for account status.

### B. Bank Statements (`BankStatementImport` & `BankStatementLine`)
- `BankStatementImport`:
  - `ImportId` (INT IDENTITY, PK)
  - `BankAccountNo` (NVARCHAR(50))
  - `BankCode` (NVARCHAR(10))
  - `FileName` (NVARCHAR(255))
  - `PeriodStart`, `PeriodEnd` (DATE)
  - `ImportedBy` (NVARCHAR(100)), `ImportedAt` (DATETIME)
  - `IsDeleted` (BIT, soft delete via migration `005`)
- `BankStatementLine`:
  - `LineId` (BIGINT IDENTITY, PK)
  - `ImportId` (INT, FK)
  - `TranDate` (DATE)
  - `Debit` (DECIMAL(18,2)), `Credit` (DECIMAL(18,2)), `Balance` (DECIMAL(18,2))
  - `ChequeNo` (NVARCHAR(50)), `Description` (NVARCHAR(500)), `Channel` (NVARCHAR(50))
  - `MatchStatus` (NVARCHAR(20)): `UNMATCHED`, `MATCHED`, etc.

### C. General Ledger Entries (`BankAccountLedgerEntries`)
Synced directly from BC365 via the sync API:
- `Entry_No` (INT, PK)
- `Bank_Account_No` (NVARCHAR(50))
- `Posting_Date` (DATETIME)
- `Document_No` (NVARCHAR(50))
- `Amount` (DECIMAL(18,2)): Positive for Debit (money in), Negative for Credit (money out)
- `Debit_Amount`, `Credit_Amount` (DECIMAL(18,2))
- `Source_Code` (NVARCHAR(50)): Special value `'REVERSAL'` marks reversal entries
- `Description` (NVARCHAR(250))
- `MatchStatus` (NVARCHAR(20)): `UNMATCHED`, `MATCHED`, `SUSPENSE`, `OFFSET`, `EXCLUDED`

### D. Reconciliation Records (`ReconciliationMatch` & `ReconciliationMatchLine`)
- `ReconciliationMatch`:
  - `MatchId` (BIGINT IDENTITY, PK)
  - `BankAccountNo` (NVARCHAR(50))
  - `MatchType` (NVARCHAR(20)): `MATCHED`, `SUSPENSE`, `OFFSET`, `EXCLUDED`
  - `BankTotal` (DECIMAL(18,2)), `GlTotal` (DECIMAL(18,2)), `Difference` (DECIMAL(18,2))
  - `Remark` (NVARCHAR(500))
  - `MatchedBy` (NVARCHAR(100)), `MatchedAt` (DATETIME)
  - `IsReversed` (BIT, migration `002`), `ReversedBy`, `ReversedAt`
- `ReconciliationMatchLine`:
  - Connects `MatchId` to `BankLineId` or `GlEntryNo`, indexed by `GroupNum`.

### E. Period Close & Workflow Tables
- `ReconciliationPeriodClose` (Migration `008`):
  - `BankAccountNo`, `PeriodStart` (Composite PK)
  - `PeriodEnd` (DATE), `Status` (`CLOSED`, `REOPENED`)
  - `BankClosingBalance`, `GlClosingBalance`, `ClosedBy`, `ClosedAt`
  - `ReopenedBy`, `ReopenedAt`, `ReopenReason`
- `ReconciliationWorkApproval` (Migration `009`):
  - `BankAccountNo`, `PeriodStart`, `Direction` (`IN`, `OUT`) (Composite PK)
  - `PeriodEnd`, `ConfirmedBy`, `ConfirmedAt`, `Note`, `DataFingerprint`
- `ReconciliationPeriodEvent` (Migration `009`):
  - Append-only audit log: `Action` (`CONFIRM`, `REOPEN_WORK`, `CLOSE`, `REOPEN_PERIOD`)
- `ReconciliationEmployeeRole` & `ReconciliationEmployeeRoleEvent` (Migrations `010`, `011`):
  - `EmployeeCode`, `RoleCode` (`AP`, `AR`, `MASTER`, `CLOSER`), `IsActive`

---

## 3. Authentication & Session Architecture

1. **Central Login API**:
   - `POST /api/login` calls `TRW_API_BASE + '/auth/auth_permission_prog'` with user credentials.
   - Response contains user profile, `employee_no`, and list of programs (`programs[]`).
   - The app verifies access using `TRW_PROGRAM_CODE` (`PRG001`).
2. **Session Cookie**:
   - Encrypted/Signed using HMAC (`SESSION_SECRET`).
   - Stored in `httpOnly` secure cookie.
   - Contains: username, employeeCode, roleProg, effectiveRole.
   - Client-side storage: Non-sensitive user info stored in `localStorage.getItem('user')` for UI display only.
3. **Audit Actor**:
   - Every mutation reads actor identity strictly from the verified session cookie via `auditActor(session)`.
