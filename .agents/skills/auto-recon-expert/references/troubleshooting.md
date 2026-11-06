# Troubleshooting & Operational Runbook: Auto Reconcile Bank

This document outlines diagnostic steps, common error messages, root causes, and verified solutions across all system modules.

---

## 1. Quick Diagnostic Checklist

| Check | Command / Action | Expected Result |
| :--- | :--- | :--- |
| **Unit Tests** | `npm test` | All 350+ Vitest tests pass cleanly. |
| **Linting** | `npm run lint` | Zero ESLint errors. |
| **Environment** | Check `.env` | `DB_*`, `BC365_SYNC_API_URL`, `TRW_PROGRAM_CODE`, `SESSION_SECRET` present. |
| **SQL Tables** | Verify migrations `sql/002` - `012` | Required tables and columns exist in `Reconcile_Bank`. |
| **API Sync** | Test `curl http://192.168.2.109:8000/sync/BankAccountLedgerEntriesUpdate40days` | Returns HTTP 200 / valid JSON. |

---

## 2. Common Errors and Resolutions

### Error 1: "งวด ... ถึง ... ของบัญชีนี้ปิดแล้ว — ต้องเปิดงวดนี้ก่อนจึงจะแก้ไขได้"
- **Status Code**: `409 Conflict` (`PeriodClosedError`).
- **Where**: Triggered by `assertDatesOpen` during Match, Unmatch, Suspense, Unsuspend, Opening Balance edit, or Bank Statement deletion.
- **Root Cause**: The transaction date falls within a period recorded as `Status = 'CLOSED'` in `ReconciliationPeriodClose` or locked by active `ReconciliationWorkApproval`.
- **Resolution**:
  1. If the user legitimately needs to modify entries in that closed period, an authorized user with the `MASTER`, `Admin`, or `Dev` role must click **"เปิดงวดคืน" (Reopen Period)** and provide an audit reason.
  2. If the user mistakenly selected dates from a past closed month, have them adjust the active date filters.

---

### Error 2: "ต้องรัน sql/008_period_close.sql กับฐานข้อมูลก่อน" (or 009, 010, 011, 012)
- **Status Code**: `409 Conflict` or migration hint banner displayed.
- **Root Cause**: The application checks table existence dynamically via guard functions (e.g. `reconcilePeriodCloseReady`, `workApprovalReady`).
- **Resolution**:
  1. Inspect which migration is missing from the error message.
  2. Run the corresponding migration file from `sql/` against the `Reconcile_Bank` database in SQL Server Management Studio (SSMS) or via CLI:
     - `sql/008_period_close.sql`
     - `sql/009_period_work_approval.sql`
     - `sql/010_employee_work_roles.sql`
     - `sql/011_master_work_role.sql`
     - `sql/012_bank_account_status.sql`
  3. Wait 30 seconds for the cache check (`READY_RECHECK_MS = 30_000`) or restart the Next.js process.

---

### Error 3: "ซิงค์ข้อมูลจาก BC365 ไม่สำเร็จ (HTTP 502)" or "เชื่อมต่อ BC365 sync service ไม่ได้"
- **Status Code**: `502 Bad Gateway`.
- **Where**: Triggered by `lib/bc365Sync.ts` during recent or full sync.
- **Root Cause**:
  - The TRW Data Center sync service (`BC365_SYNC_API_URL`, default `http://192.168.2.109:8000`) is offline, unreachable from the server, or timed out.
  - The corporate network / VPN link to 192.168.2.109 is down.
- **Resolution**:
  1. Check network connectivity: `ping 192.168.2.109`.
  2. Verify if the sync server process is running on the host machine.
  3. Ensure `.env` contains the correct `BC365_SYNC_API_URL`.

---

### Error 4: Silent Date Swapping (Day & Month Inversion)
- **Symptom**: Statements imported from Excel/CSV show dates like `12/05/2026` stored as `2026-12-05` (December 5th instead of May 12th).
- **Root Cause**: Standard JavaScript `new Date("12/05/2026")` parses strings in American format (`MM/DD/YYYY`). Any day ≤ 12 is silently treated as the month!
- **Prevention & Fix**:
  - **NEVER** use `new Date(str)` directly on bank statement input.
  - Always route raw dates through `toISODate()` in `lib/bankParsers/types.ts`.
  - Buddhist Era years (e.g., 2569) are automatically adjusted (`year - 543 -> 2026`).

---

### Error 5: "ไม่สามารถลบไฟล์ Bank Statement ได้เนื่องจากมีรายการถูกจับคู่แล้ว"
- **Status Code**: `400 Bad Request` or `DeleteBlockedError`.
- **Root Cause**: Bank statements maintain strict audit integrity. Lines referenced in `ReconciliationMatchLine` cannot be orphaned.
- **Resolution**:
  1. Go to **Match History** (`/reconcile/history`).
  2. Filter by the bank account and period.
  3. Unmatch (ยกเลิกการจับคู่) all groups containing lines from that statement import file.
  4. Return to **Master Data > Bank Statement** and proceed with deleting the import file.

---

### Error 6: "ยอดคงเหลือในไฟล์ต่อกันไม่สมบูรณ์" (`chainOk = false`)
- **Where**: Bank statement balance continuity validation in `lib/bankBalance.ts`.
- **Root Cause**:
  - A statement file has missing rows or non-consecutive transactions where `prevBalance + netMovement != currentBalance`.
  - Statement file lines were imported out of order or multiple disjointed batches were loaded.
- **Resolution**:
  - Verify the original Excel/CSV file from the bank.
  - Confirm whether missing transaction rows exist in the online bank portal.
  - Check `bankBalance.test.ts` for reference handling of balance chains.

---

### Error 7: "ผู้ใช้ไม่มีสิทธิ์ทำงานกระทบยอดฝั่ง..." (`WorkPermissionError`)
- **Status Code**: `403 Forbidden`.
- **Root Cause**: The logged-in user is a central `User` who has not been granted the specific in-program work role (`AP` for OUT, `AR` for IN, or `MASTER` for all).
- **Resolution**:
  1. An administrator (Dev, Central Admin, or user with `MASTER` role) must navigate to `/master-data/work-roles`.
  2. Search for the employee by code or name using `EmployeeLookup`.
  3. Check the required role (`AP` or `AR` or `MASTER`) and save.
  4. The permission takes effect on the next action immediately (no cookie re-issue required).
