import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';
import { getPool } from '../../../../lib/db';
import { auditWorkActor as auditActor, requireRole } from '../../../../lib/session';
import { ADMIN_ROLES } from '../../../../lib/roles';
import { badRequest } from '../../../../lib/apiInput';
import { isWorkRole, normalizeEmployeeCode } from '../../../../lib/workRoles';
import { workRolesReady, WORK_ROLES_MIGRATION_HINT } from '../../../../lib/workRolesDb';
import { remarkProblem } from '../../../../lib/matchRemark';
import { employeeNames } from '../../../../lib/employeeDirectoryDb';

export const dynamic = 'force-dynamic';

class EmployeeVerificationError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

// Central Admin/Dev (and Users holding MASTER) administer in-program roles for central Users.
export async function GET(req: NextRequest) {
  const auth = await requireRole(ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const raw = req.nextUrl.searchParams.get('employeeCode');
  const employee = raw ? normalizeEmployeeCode(raw) : null;
  if (raw && !employee) return badRequest('EMP code ไม่ถูกต้อง');
  try {
    const pool = await getPool();
    if (!await workRolesReady(pool)) return NextResponse.json({ error: WORK_ROLES_MIGRATION_HINT }, { status: 409 });
    const roles = await pool.request().input('emp', sql.NVarChar(50), employee).query(`
      SELECT TOP (201) EmployeeCode AS employeeCode, RoleCode AS roleCode, IsActive AS isActive,
        UpdatedBy AS updatedBy, UpdatedAt AS updatedAt
      -- CLOSER เลิกใช้แล้ว (AP+AR ยืนยันครบ = ปิดงวด) แถวเก่าคงไว้เป็นประวัติแต่ไม่แสดงเป็นสิทธิ์ที่ใช้อยู่
      FROM ReconciliationEmployeeRole WHERE (@emp IS NULL OR EmployeeCode=@emp) AND RoleCode IN ('AP', 'AR', 'MASTER')
      ORDER BY EmployeeCode, RoleCode
    `);
    const history = await pool.request().input('emp', sql.NVarChar(50), employee).query(`
      SELECT TOP (50) EventId AS eventId, EmployeeCode AS employeeCode, RoleCode AS roleCode,
        IsActive AS isActive, Actor AS actor, Reason AS reason, CreatedAt AS createdAt
      FROM ReconciliationEmployeeRoleEvent WHERE @emp IS NULL OR EmployeeCode=@emp ORDER BY EventId DESC
    `);
    const assignments = roles.recordset.slice(0, 200);
    let names = new Map<string, string>();
    let directoryWarning: string | undefined;
    try {
      names = await employeeNames(pool, [...assignments, ...history.recordset].map((row) => row.employeeCode));
    } catch {
      // Directory availability must not prevent reviewing or revoking existing assignments.
      directoryWarning = 'โหลดชื่อพนักงานไม่ได้ ขณะนี้แสดงเฉพาะ EMP code กรุณาตรวจการเชื่อมต่อ DATA_CENTER';
    }
    const withName = (row: { employeeCode: string }) => ({ ...row,
      employeeName: names.get(row.employeeCode.trim().toUpperCase()) ?? null });
    return NextResponse.json({ roles: assignments.map(withName), truncated: roles.recordset.length > 200,
      history: history.recordset.map(withName), directoryWarning }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('Work roles GET error:', err);
    return NextResponse.json({ error: 'โหลดสิทธิ์พนักงานไม่สำเร็จ' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole(ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => null);
    const employee = normalizeEmployeeCode(body?.employeeCode);
    const role = body?.roleCode;
    const active = body?.isActive;
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (!employee) return badRequest('EMP code ต้องยาว 1–50 ตัว และใช้ตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง');
    if (!isWorkRole(role) || typeof active !== 'boolean') return badRequest('สิทธิ์หรือสถานะไม่ถูกต้อง');
    // MASTER เปลี่ยน role ที่ใช้งานจริง — ถอด MASTER ของตัวเองจะล็อกตัวเองออกจากหน้านี้
    if (role === 'MASTER' && employee === normalizeEmployeeCode(auth.session.employeeNo)) {
      return NextResponse.json({ error: 'เปลี่ยนสิทธิ์ MASTER ของตัวเองไม่ได้ กรุณาให้ Admin, Dev หรือ Master Admin คนอื่นดำเนินการ' }, { status: 403 });
    }
    const problem = remarkProblem(reason);
    if (problem) return badRequest(problem);
    const pool = await getPool();
    if (!await workRolesReady(pool)) return NextResponse.json({ error: WORK_ROLES_MIGRATION_HINT }, { status: 409 });
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // Verify on every activation, including direct API calls. Keep the employee
      // read lock until the grant commits so deletion cannot race the validation.
      // Revocation deliberately does not depend on the central directory.
      if (active) {
        let exists: boolean;
        try {
          const result = await new sql.Request(tx).input('emp', sql.NVarChar(50), employee)
            .query(`SELECT TOP (1) 1 AS Found FROM [DATA_CENTER].[dbo].[Employee] WITH (HOLDLOCK)
              WHERE [No]=@emp`);
          exists = result.recordset.length > 0;
        } catch {
          throw new EmployeeVerificationError('ตรวจสอบทะเบียนพนักงานไม่ได้ จึงยังเปิดสิทธิ์ไม่ได้ กรุณาลองใหม่ หรือติดต่อผู้ดูแลระบบ (ยังปิดสิทธิ์เดิมได้)', 503);
        }
        if (!exists) throw new EmployeeVerificationError(`ไม่พบ EMP code ${employee} ในทะเบียนพนักงาน จึงเปิดสิทธิ์ไม่ได้ กรุณาค้นหาและเลือกรหัสพนักงานที่ถูกต้อง`, 422);
      }
      const actor = auditActor(auth.session);
      await new sql.Request(tx).input('emp', sql.NVarChar(50), employee).input('role', sql.VarChar(20), role)
        .input('active', sql.Bit, active).input('actor', sql.NVarChar(100), actor).input('reason', sql.NVarChar(500), reason)
        .query(`
          DECLARE @old BIT = 0;
          SELECT @old=IsActive FROM ReconciliationEmployeeRole WITH (UPDLOCK, HOLDLOCK)
            WHERE EmployeeCode=@emp AND RoleCode=@role;
          IF @old <> @active
          BEGIN
            MERGE ReconciliationEmployeeRole WITH (HOLDLOCK) AS t
            USING (SELECT @emp AS EmployeeCode, @role AS RoleCode) AS s
              ON t.EmployeeCode=s.EmployeeCode AND t.RoleCode=s.RoleCode
            WHEN MATCHED THEN UPDATE SET IsActive=@active, UpdatedBy=@actor, UpdatedAt=SYSDATETIMEOFFSET()
            WHEN NOT MATCHED THEN INSERT (EmployeeCode, RoleCode, IsActive, UpdatedBy) VALUES (@emp, @role, @active, @actor);
            INSERT INTO ReconciliationEmployeeRoleEvent (EmployeeCode, RoleCode, WasActive, IsActive, Actor, Reason)
              VALUES (@emp, @role, @old, @active, @actor, @reason);
          END
        `);
      await tx.commit();
      return NextResponse.json({ success: true });
    } catch (err) {
      await tx.rollback();
      if (err instanceof EmployeeVerificationError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
  } catch (err) {
    console.error('Work roles PUT error:', err);
    return NextResponse.json({ error: 'บันทึกสิทธิ์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' }, { status: 500 });
  }
}
