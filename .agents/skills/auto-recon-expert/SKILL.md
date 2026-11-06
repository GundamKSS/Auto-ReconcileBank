---
name: auto-recon-expert
description: >-
  Comprehensive domain knowledge, architecture reference, and troubleshooting guide for
  TRW Auto Reconcile Bank (web-app). Use whenever developing, debugging, running tests,
  or solving issues related to Bank Statement parsing (KBANK, SCB, BBL), GL sync from
  BC365, matching algorithms (1:1, 1:N, N:1, N:M), GL offsets (REVERSAL), suspense entries,
  period closing & work approval workflows (AP/AR/MASTER), employee work roles, and SQL Server migrations.
---

# Auto Reconcile Bank Expert Guide

This skill equips the agent with end-to-end domain knowledge, architectural details, operational procedures, and troubleshooting guides for the **TRW Auto Reconcile Bank** system (`web-app`).

---

## 1. System Overview & Technology Stack

- **Framework**: Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4.
- **Database**: Microsoft SQL Server (`mssql`), database name `Reconcile_Bank`.
- **Testing**: Vitest (`npm test` runs 350+ tests).
- **ERP Integration**: Microsoft Dynamics 365 Business Central (BC365) via TRW Data Center API (`http://192.168.2.109:8000`).
- **Core Purpose**: Reconcile external Bank Statements (KBANK, SCB, BBL) with internal accounting General Ledger entries (`BankAccountLedgerEntries`) from BC365.

---

## 2. Core Concepts & Business Invariants

| Concept | Definition & Rules |
| :--- | :--- |
| **Directions** | **AR = IN** (Money in; Bank Credit ↔ GL Debit)<br>**AP = OUT** (Money out; Bank Debit ↔ GL Credit). Direction must always be opposite across Bank and GL. |
| **Account Keys** | `bankAccountNo` = BC365 identifier (e.g. `TW_SCB_C1`), primary key in `BankAccountMapping`.<br>`displayNo` = Real bank account number parsed from `#` in name (e.g. `037-3-029725`). |
| **Tolerance** | Exact match required; maximum allowed difference is **0.005 THB** (rounding error only). |
| **Match Types** | - `MATCHED`: Bank lines paired with GL entries (1:1, 1:N, N:1, N:M).<br>- `OFFSET`: GL entries cancelling each other (`Source_Code = 'REVERSAL'`). No bank lines involved.<br>- `SUSPENSE`: Outstanding GL entries set aside. **Bank lines CANNOT be suspended** (bank records are immutable).<br>- `EXCLUDED`: GL adjustment items (e.g. month-end JV adjustments) with mandatory remark. |
| **Period Workflow** | AP (OUT) and AR (IN) confirm their respective sides independently. When both sides confirm, the period is locked and closed. Only **MASTER** role can reopen a closed period. |
| **Date Parsing** | Thai date format is `DD/MM/YYYY`. Buddhist Era (`>= 2400`) converted to CE (`year - 543`). **NEVER use `new Date(string)`** directly (causes silent MM/DD swaps). |

For complete architectural and data model details, see [Architecture Reference](./references/architecture.md).
For in-depth matching algorithms and business rules, see [Business Rules](./references/business-rules.md).
For operational playbooks and error resolution, see [Troubleshooting Guide](./references/troubleshooting.md).

---

## 3. Quick Runbook

### Running Verification & Tests
Always run the test suite before and after making any modifications:
```bash
npm test
```
To run an individual test file:
```bash
npx vitest run tests/periodWorkflowApi.test.ts
```

### Checking Database Migrations
Database scripts are ordered sequentially in `sql/` (`002` through `012`):
- `008_period_close.sql`: Creates `ReconciliationPeriodClose`.
- `009_period_work_approval.sql`: Creates `ReconciliationWorkApproval` and `ReconciliationPeriodEvent`.
- `010_employee_work_roles.sql`: Creates `ReconciliationEmployeeRole` and `ReconciliationEmployeeRoleEvent`.
- `011_master_work_role.sql`: Expands role check constraint to include `MASTER`.
- `012_bank_account_status.sql`: Adds `IsActive`, `CreatedBy`, `StatusChangedAt`, `StatusChangedBy` to `BankAccountMapping`.

When encountering SQL or feature errors related to tables or columns, verify whether the corresponding migration script has been applied.

---

## 4. Key Implementation Patterns

### 1. Date Handling
```typescript
// ALWAYS use the project's toISODate or buildISODate helper from lib/bankParsers/types.ts
import { toISODate } from '@/lib/bankParsers/types';
const iso = toISODate(rawString); // Returns 'YYYY-MM-DD' or null
```

### 2. Period Lock Check Before Mutations
Any API route modifying reconciliation state (matching, unmatching, suspense, balance edit, statement deletion) **must** invoke `assertDatesOpen`:
```typescript
import { assertDatesOpen } from '@/lib/periodClose';
await assertDatesOpen(tx, bankAccountNo, datesToModify);
```

### 3. Role & Permission Resolution
- **Central Roles** (`lib/roles.ts`): `Dev` (highest, all access), `Admin` (Master Admin), `User` (Viewer by default).
- **In-Program Work Roles** (`lib/workRoles.ts`): Assigned to `EmployeeCode` for central Users:
  - `AP`: Can confirm/reopen OUT.
  - `AR`: Can confirm/reopen IN.
  - `MASTER`: Full administrative access (AP + AR + Period Reopen + User assignment).

### 4. BC365 Sync Endpoints
- **Recent Sync (40 Days)**: `/sync/BankAccountLedgerEntriesUpdate40days` (Fast, used in Reconcile screen).
- **Full Sync**: `/sync/BankAccountLedgerEntries` (Slow, comprehensive, used in Import screen).
