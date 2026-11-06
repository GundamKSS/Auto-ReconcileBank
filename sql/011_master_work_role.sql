/* Apply to Reconcile_Bank after 010. Idempotent; only widens the allowed RoleCode values.
   In-program roles (for central Users only) are now AP, AR and MASTER:
     MASTER = everything AP + AR can do, reopening closed periods, and managing /master-data/work-roles.
   Central Dev (highest) and Admin (= Master Admin) need no row here.
   CLOSER is retired — AP and AR both confirming a period closes it — but stays in the
   constraint because existing assignment/audit rows hold it; the app ignores those rows.
   Until this runs, the work-roles page rejects MASTER with a constraint error. */
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF OBJECT_ID('dbo.ReconciliationEmployeeRole', 'U') IS NULL
  THROW 50000, 'Run 010_employee_work_roles.sql first', 1;
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EmployeeRole_Code')
  ALTER TABLE dbo.ReconciliationEmployeeRole DROP CONSTRAINT CK_EmployeeRole_Code;
ALTER TABLE dbo.ReconciliationEmployeeRole ADD CONSTRAINT CK_EmployeeRole_Code
  CHECK (RoleCode IN ('AP', 'AR', 'CLOSER', 'MASTER'));
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_EmployeeRoleEvent_Code')
  ALTER TABLE dbo.ReconciliationEmployeeRoleEvent DROP CONSTRAINT CK_EmployeeRoleEvent_Code;
ALTER TABLE dbo.ReconciliationEmployeeRoleEvent ADD CONSTRAINT CK_EmployeeRoleEvent_Code
  CHECK (RoleCode IN ('AP', 'AR', 'CLOSER', 'MASTER'));
COMMIT;
