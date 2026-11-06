import sql from 'mssql';
import { getPool } from './db';
import type { Session } from './session';
import { centralRoleIsMaster, directionWorkRole, effectiveWorkRoles, masterPermissions, hasWorkRole, isWorkRole, missingWorkSide, normalizeEmployeeCode, WORK_ROLE_LABELS,
  type WorkDirection, type WorkPermissions, type WorkRole } from './workRoles';

type Connection = sql.ConnectionPool | sql.Transaction;
const requestFor = (connection: Connection) => connection instanceof sql.Transaction
  ? new sql.Request(connection) : new sql.Request(connection);
export const WORK_ROLES_MIGRATION_HINT = 'ต้องรัน sql/010_employee_work_roles.sql และกำหนดสิทธิ์ตาม EMP code ก่อนยืนยันงานหรือปิดงวด';

export async function workRolesReady(connection: Connection): Promise<boolean> {
  const result = await requestFor(connection).query(`SELECT CASE WHEN
    OBJECT_ID('dbo.ReconciliationEmployeeRole', 'U') IS NOT NULL AND
    OBJECT_ID('dbo.ReconciliationEmployeeRoleEvent', 'U') IS NOT NULL THEN 1 ELSE 0 END AS Ready`);
  return Number(result.recordset[0]?.Ready) === 1;
}

export async function readWorkPermissions(session: Session, connection?: Connection): Promise<WorkPermissions> {
  const db = connection ?? await getPool();
  const employeeCode = normalizeEmployeeCode(session.employeeNo);
  const ready = await workRolesReady(db);
  // Dev/Admin ระบบกลาง (หรือ User ที่ requireRole ยกเป็น Admin เพราะมี MASTER) = Master Admin ไม่ต้องอ่านสิทธิ์ในโปรแกรม
  if (centralRoleIsMaster(session.role)) return masterPermissions(ready, employeeCode);
  if (!ready || !employeeCode) return { ready, employeeCode, roles: [] };
  // Under a write transaction this shared range lock keeps a concurrent revocation ordered
  // against the action. No cache: a revoked role takes effect on the next request.
  const result = await requestFor(db).input('emp', sql.NVarChar(50), employeeCode).query(`
    SELECT RoleCode FROM ReconciliationEmployeeRole WITH (HOLDLOCK)
    WHERE EmployeeCode=@emp AND IsActive=1
  `);
  return { ready, employeeCode, roles: effectiveWorkRoles(result.recordset.map((r) => r.RoleCode).filter(isWorkRole)) };
}

export class WorkPermissionError extends Error {
  constructor(message: string, public status: number = 403) { super(message); }
}

// Matching/unmatching/un-suspending lines of a side requires that side's AP/AR role, so an AR
// employee cannot change money-out work. Skipped until sql/010 is installed so existing deployments
// keep working; the work-roles page then decides who owns which side.
export async function assertWorkSides(session: Session, directions: (WorkDirection | undefined)[], connection: Connection,
  mode: 'all' | 'any' = 'all') {
  const sides = [...new Set(directions.filter((d): d is WorkDirection => d === 'IN' || d === 'OUT'))];
  if (sides.length === 0) return;
  const permissions = await readWorkPermissions(session, connection);
  if (!permissions.ready) return;
  if (!permissions.employeeCode && permissions.roles.length === 0) throw new WorkPermissionError('ไม่พบ EMP code ใน session กรุณาเข้าสู่ระบบใหม่ หรือติดต่อผู้ดูแลระบบ');
  const missing = missingWorkSide(permissions, sides, mode);
  if (missing && mode === 'any') throw new WorkPermissionError(`EMP code ${permissions.employeeCode} ไม่มีสิทธิ์ AP หรือ AR — ต้องมีสิทธิ์ฝั่งใดฝั่งหนึ่งจึงจะหักล้างรายการได้`);
  if (missing) throw new WorkPermissionError(`EMP code ${permissions.employeeCode} ไม่มีสิทธิ์${WORK_ROLE_LABELS[directionWorkRole(missing)]} — แก้ไขได้เฉพาะฝั่งของตัวเอง`);
}

export async function assertWorkRole(session: Session, role: WorkRole, connection: Connection) {
  const permissions = await readWorkPermissions(session, connection);
  if (!permissions.ready) throw new WorkPermissionError(WORK_ROLES_MIGRATION_HINT, 409);
  if (!permissions.employeeCode && permissions.roles.length === 0) throw new WorkPermissionError('ไม่พบ EMP code ใน session กรุณาเข้าสู่ระบบใหม่ หรือติดต่อผู้ดูแลระบบ');
  if (!hasWorkRole(permissions, role)) throw new WorkPermissionError(`EMP code ${permissions.employeeCode} ไม่มีสิทธิ์${WORK_ROLE_LABELS[role]}`);
}
