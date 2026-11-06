import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '../../../../lib/db';
import { requireRole } from '../../../../lib/session';
import { ADMIN_ROLES } from '../../../../lib/roles';
import { normalizeEmployeeCode } from '../../../../lib/workRoles';
import { searchEmployees } from '../../../../lib/employeeDirectoryDb';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(req: NextRequest) {
  const auth = await requireRole(ADMIN_ROLES);
  if (!auth.ok) return auth.response;
  const exact = req.nextUrl.searchParams.has('employeeCode');
  const raw = (req.nextUrl.searchParams.get(exact ? 'employeeCode' : 'q') ?? '').trim();
  const query = exact ? normalizeEmployeeCode(raw) : raw;
  if (!query || query.length > 100 || (!exact && query.length < 2)) {
    return NextResponse.json({ error: exact ? 'EMP code ไม่ถูกต้อง' : 'กรุณาระบุรหัสหรือชื่อพนักงาน 2–100 ตัวอักษร' }, { status: 400, headers });
  }
  try {
    return NextResponse.json(await searchEmployees(await getPool(), query, exact), { headers });
  } catch (err) {
    console.error('Employee directory lookup failed:', err instanceof Error ? err.name : 'Database error');
    return NextResponse.json({ error: 'ค้นหาพนักงานไม่ได้ กรุณาลองใหม่ หรือติดต่อผู้ดูแลให้ตรวจสิทธิ์อ่าน DATA_CENTER.dbo.Employee' }, { status: 503, headers });
  }
}
