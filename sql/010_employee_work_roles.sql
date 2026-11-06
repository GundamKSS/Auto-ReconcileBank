/* Apply to Reconcile_Bank after 009. Idempotent, additive; no automatic user grants.
   Identity comes ONLY from employee_no returned by trusted central authentication.
   One employee can hold multiple roles. Central app access is still required.
   Admin/Dev manage assignments at /master-data/work-roles, but have no automatic
   AP/AR/CLOSER permission. Existing sessions must log in again to obtain EMP code.
   Revocation takes effect on the next action without waiting for cookie expiry.
   Existing approvals remain an audited business fact when a person's role is revoked.
   Do not drop these tables to roll back: retain both assignments and audit history. */
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ReconciliationWorkApproval', 'U') IS NULL
  THROW 50000, 'Run 009_period_work_approval.sql first', 1;
IF OBJECT_ID('dbo.ReconciliationEmployeeRole', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReconciliationEmployeeRole (
    EmployeeCode NVARCHAR(50) NOT NULL,
    RoleCode VARCHAR(20) NOT NULL,
    IsActive BIT NOT NULL,
    UpdatedBy NVARCHAR(100) NOT NULL,
    UpdatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT PK_ReconciliationEmployeeRole PRIMARY KEY (EmployeeCode, RoleCode),
    CONSTRAINT CK_EmployeeRole_Code CHECK (RoleCode IN ('AP', 'AR', 'CLOSER'))
  );
END;
IF OBJECT_ID('dbo.ReconciliationEmployeeRoleEvent', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ReconciliationEmployeeRoleEvent (
    EventId BIGINT IDENTITY PRIMARY KEY,
    EmployeeCode NVARCHAR(50) NOT NULL,
    RoleCode VARCHAR(20) NOT NULL,
    WasActive BIT NOT NULL,
    IsActive BIT NOT NULL,
    Actor NVARCHAR(100) NOT NULL,
    Reason NVARCHAR(500) NOT NULL,
    CreatedAt DATETIMEOFFSET NOT NULL DEFAULT SYSDATETIMEOFFSET(),
    CONSTRAINT CK_EmployeeRoleEvent_Code CHECK (RoleCode IN ('AP', 'AR', 'CLOSER'))
  );
END;
COMMIT;
