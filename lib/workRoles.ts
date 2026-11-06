import type { AppRole, Role } from './roles';

// สิทธิ์ในโปรแกรม ผูกกับ EMP code — ใช้กับ User จากระบบกลางเท่านั้น
// Dev (สูงสุด) และ Admin (= Master Admin) ระบบกลางได้ทุกสิทธิ์ในตัวโดยไม่ต้องกำหนดในโปรแกรม
// ไม่มี CLOSER แล้ว: AP และ AR ยืนยันงานครบ = ปิดงวดทันที เปิดงวดคืนได้เฉพาะ MASTER
export const WORK_ROLES = ['AP', 'AR', 'MASTER'] as const;
export type WorkRole = typeof WORK_ROLES[number];
export const WORK_ROLE_LABELS: Record<WorkRole, string> = {
  AP: 'ยืนยัน / เปิดงาน AP (เงินออก)',
  AR: 'ยืนยัน / เปิดงาน AR (เงินเข้า)',
  MASTER: 'Master Admin — ทำได้ทุกอย่าง: AP + AR, เปิดงวดที่ปิดแล้ว และให้สิทธิ์',
};
const MASTER_ROLES: readonly WorkRole[] = ['AP', 'AR', 'MASTER'];
// MASTER carries every workflow role.
export function effectiveWorkRoles(assigned: readonly WorkRole[]): WorkRole[] {
  if (assigned.includes('MASTER')) return [...MASTER_ROLES];
  return [...new Set(assigned)];
}
// Dev and Admin from the central system are Master Admin without any in-program assignment.
export function centralRoleIsMaster(role: AppRole): boolean {
  return role === 'Admin' || role === 'Dev';
}
export function masterPermissions(ready: boolean, employeeCode: string | null): WorkPermissions {
  return { ready, employeeCode, roles: [...MASTER_ROLES] };
}
// The role this program acts on. Dev/Admin come only from the central system; a central User is
// what the in-program roles say: MASTER → Admin, AP/AR → Staff (own side only), none → User (Viewer).
export function effectiveAppRole(role: Role, permissions: WorkPermissions | undefined): AppRole {
  if (role !== 'User') return role;
  if (hasWorkRole(permissions, 'MASTER')) return 'Admin';
  if (hasWorkRole(permissions, 'AP') || hasWorkRole(permissions, 'AR')) return 'Staff';
  return 'User';
}
export type WorkPermissions = { ready: boolean; employeeCode: string | null; roles: WorkRole[] };
export function isWorkRole(value: unknown): value is WorkRole {
  return typeof value === 'string' && WORK_ROLES.some((role) => role === value);
}
export function normalizeEmployeeCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._-]{0,49}$/.test(code) ? code : null;
}
export type WorkDirection = 'IN' | 'OUT';
export const directionWorkRole = (direction: WorkDirection): WorkRole => direction === 'OUT' ? 'AP' : 'AR';
// roles มาจาก readWorkPermissions เท่านั้น ซึ่งคืนสิทธิ์ในโปรแกรมว่างเมื่อไม่มี EMP code อยู่แล้ว
// (Admin/Dev ไม่ต้องมี EMP code เพราะสิทธิ์มาจากระบบกลาง)
export function hasWorkRole(permissions: WorkPermissions | undefined, role: WorkRole): boolean {
  return Boolean(permissions?.ready && permissions.roles.includes(role));
}
// Sides whose data the employee sees (reconcile tabs, history, suspense): one AP/AR role → only that side.
// Both roles, MASTER, neither or roles not installed → both (still read-only without a role).
export function visibleWorkSides(permissions: WorkPermissions | undefined): WorkDirection[] {
  const own = (['IN', 'OUT'] as const).filter((d) => !missingWorkSide(permissions, [d]));
  return own.length === 0 ? ['IN', 'OUT'] : [...own];
}
// The first side the employee may not edit; undefined while roles are not installed (nothing enforced yet).
// mode 'any' is for GL offsets: one pair always holds both IN and OUT lines, so either AP or AR may do it.
export function missingWorkSide(permissions: WorkPermissions | undefined, directions: readonly WorkDirection[],
  mode: 'all' | 'any' = 'all'): WorkDirection | undefined {
  if (!permissions?.ready) return undefined;
  const allowed = (d: WorkDirection) => hasWorkRole(permissions, directionWorkRole(d));
  if (mode === 'any') return directions.length === 0 || directions.some(allowed) ? undefined : directions[0];
  return directions.find((d) => !allowed(d));
}
