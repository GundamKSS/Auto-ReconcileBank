# Business Rules Reference: Auto Reconcile Bank

This document details the core domain rules, matching mechanics, period close workflows, and security restrictions implemented in the system.

---

## 1. Direction Mapping (AR vs AP)

| Perspective | Direction Code | Bank Statement Column | GL Equivalent (`BankAccountLedgerEntries`) |
| :--- | :--- | :--- | :--- |
| **AR (Receivables)** | `IN` (เงินเข้า) | `Credit` (เงินเข้าธนาคาร) | `Debit` / Positive Amount |
| **AP (Payables)** | `OUT` (เงินออก) | `Debit` (เงินออกจากธนาคาร) | `Credit` / Negative Amount |

**Core Rule**: A match is only valid when Bank and GL have opposite financial signs (e.g., Bank Credit matches GL Debit).

---

## 2. Matching Rules & Algorithms

### A. Strict Tolerance (0.005 THB)
- Financial equality must be exact: `Math.abs(BankTotal - GlTotal) < 0.005`.
- Rounding differences greater than half a satang (0.005) cannot be matched unless explicitly handled via `EXCLUDED` or authorized differences with remarks.

### B. Group Cardinalities
- `1:1`: Single Bank line matches single GL entry.
- `1:N`: Single Bank statement line matches multiple GL entries (e.g. bulk deposit).
- `N:1`: Multiple Bank statement lines match single GL entry.
- `N:M`: Multiple Bank lines match multiple GL entries within a designated group.
- **Algorithm**: Subset Sum backtracking (`findSubsetSum` in `lib/matchAssistant.ts`), limited to `maxSize = 5` items per cluster to guarantee optimal performance.

### C. Match Assistant (`lib/matchAssistant.ts`)
- Scans for candidates within configurable date windows (3, 7, 15, 30 days; default 7, max 31).
- Evaluates candidate pairs by:
  - Day gap (calendar and business days).
  - Exact reference matching (e.g. invoice/receipt numbers).
  - Channel / description heuristics.
- Assigns confidence scores (High: ≥75, Medium: ≥50, Low: <50).
- **Mandatory Human Confirmation**: Assistant **never** auto-commits matches. Users must review suggestions and explicitly press "Match".

---

## 3. GL Offsets (`lib/glOffset.ts`)

- **Definition**: Internal GL entries that negate each other (net zero) without ever generating an actual bank transaction.
- **Reversal Detection**:
  - Automatically identifies entries where `Source_Code = 'REVERSAL'`.
  - Pairs each reversal entry with its original entry by verifying:
    1. Same account (`accountNo`).
    2. Exact same document number (`documentNo`).
    3. Exactly opposite amounts (`original + reversal == 0`).
- **Safety Restriction**: The system deliberately **does not** auto-offset based solely on amount and date. Historical data revealed edge cases where different documents had identical amounts on the same day, which would lead to incorrect offsets.

---

## 4. Suspense Management (`lib/suspenseSelection.ts`)

- **Immutable Bank Records**: Bank statement records are third-party legal documents and **must never be marked as Suspense**.
- **GL Suspense**: Unreconciled GL entries can be temporarily moved to `SUSPENSE` to keep the active reconciliation view clean.
- **Aging & Unsuspension**:
  - Displays aging badges for suspense items.
  - Users can batch unsuspend entries once supporting documentation is ready, returning them to the active matching pool.

---

## 5. Period Workflow & Closing (`lib/periodWorkflow.ts`)

### Two-Step Confirmation Workflow
```
[ Open Period ]
      │
      ├──> AP (OUT) Confirmed by AP Role (Data Fingerprint saved)
      │
      └──> AR (IN) Confirmed by AR Role (Data Fingerprint saved)
      │
      ▼
[ Both Sides Confirmed ] ──> Automatically Locked / Closed
```

### Period Invariants
1. Both `IN` (AR) and `OUT` (AP) must be confirmed for the identical date range (`PeriodStart` to `PeriodEnd`).
2. Source data fingerprints must remain unchanged between confirmation and closing.
3. The remaining difference between Bank Closing Balance and GL Closing Balance must be zero (`< 0.005 THB`).
4. Once closed:
   - Any write operation (`Match`, `Unmatch`, `Suspense`, `Unsuspend`, `Opening Balance Edit`, `Delete Statement`) for dates falling in a closed period is strictly blocked with `PeriodClosedError` (HTTP 409).
   - Only a user with the **MASTER** role can reopen a closed period, requiring an explicit reason.
   - Reopening invalidates both AP and AR confirmations, returning the period to open status.

---

## 6. Role & Permission Hierarchy (`lib/roles.ts`, `lib/workRoles.ts`)

1. **Central Dev**: Superuser; unrestricted access across all features.
2. **Central Admin**: Master Admin; full operational and administrative capabilities.
3. **Central User**: Default role. Capabilities depend on in-program assignment to `EmployeeCode`:
   - `MASTER`: Identical permissions to Master Admin inside this application.
   - `AP`: Can access reconciliation and confirm/reopen AP (OUT) periods.
   - `AR`: Can access reconciliation and confirm/reopen AR (IN) periods.
   - *No role assigned*: Read-only viewer (Dashboard and Reports only).
