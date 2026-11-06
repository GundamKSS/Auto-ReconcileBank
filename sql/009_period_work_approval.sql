/* Run against Reconcile_Bank after 008_period_close.sql. Safe to re-run.
   AP = OUT, AR = IN. Existing closed periods remain closed; no backfilled approvals.
   Reopening a final close invalidates both approvals. Events are append-only.
   Apply during a maintenance window with all app instances on the new version.

   Workflow: confirm OUT (AP) and IN (AR), either order, for the EXACT same date range;
   then final close requires both approvals, unchanged source fingerprints and remaining < 0.005.
   A side can be reopened with a reason; reopening final close clears both current approvals.
   Install 010_employee_work_roles.sql to assign AP/AR/CLOSER responsibilities by employee code.
   Historical final closes stay locked without synthetic AP/AR confirmations.

   Locks cover app reconciliation writes/imports. External ERP jobs/direct SQL do not participate
   in app locks: changed source rows are detected at final close, but this migration does not
   freeze BC365 or prevent external changes AFTER closing. Coordinate ERP period controls separately.
   Validate on a staging copy before production. Do not drop these tables as a rollback while
   approvals exist: that would discard active locks and audit history. */
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ReconciliationPeriodClose', 'U') IS NULL
  THROW 50000, 'Run 008_period_close.sql first', 1;

IF OBJECT_ID('dbo.ReconciliationWorkApproval', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReconciliationWorkApproval (
    BankAccountNo NVARCHAR(50) NOT NULL,
    PeriodStart DATE NOT NULL,
    PeriodEnd DATE NOT NULL,
    Direction NVARCHAR(3) NOT NULL,
    ConfirmedBy NVARCHAR(100) NOT NULL,
    ConfirmedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    Note NVARCHAR(500) NOT NULL,
    DataFingerprint VARCHAR(64) NOT NULL,
    CONSTRAINT PK_ReconciliationWorkApproval PRIMARY KEY (BankAccountNo, PeriodStart, Direction),
    CONSTRAINT CK_WorkApproval_Direction CHECK (Direction IN ('IN', 'OUT')),
    CONSTRAINT CK_WorkApproval_Range CHECK (PeriodStart <= PeriodEnd),
    CONSTRAINT FK_WorkApproval_Account FOREIGN KEY (BankAccountNo) REFERENCES dbo.BankAccountMapping(BankAccountNo)
  );
END;
IF OBJECT_ID('dbo.ReconciliationPeriodEvent', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReconciliationPeriodEvent (
    EventId BIGINT IDENTITY PRIMARY KEY,
    BankAccountNo NVARCHAR(50) NOT NULL,
    PeriodStart DATE NOT NULL,
    PeriodEnd DATE NOT NULL,
    Action NVARCHAR(20) NOT NULL,
    Direction NVARCHAR(3) NULL,
    Actor NVARCHAR(100) NOT NULL,
    Reason NVARCHAR(500) NOT NULL,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT CK_PeriodEvent_Action CHECK (Action IN ('CONFIRM', 'REOPEN_WORK', 'CLOSE', 'REOPEN_PERIOD'))
  );
END;
COMMIT;
