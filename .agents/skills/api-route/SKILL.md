---
name: api-route
description: >-
  Create or modify a Next.js 16 App Router API route (app/api/**/route.ts) and the client component that
  calls it, following the Auto Reconcile Bank architecture (requireRole, lib/apiInput validation, mssql pool
  and transactions, period-lock checks, Vitest API tests). Use when the user asks to add/change an endpoint,
  API, route handler, "สร้าง API", "เพิ่ม endpoint", "แก้ route", or build a page/component that reads or writes data.
---

# Goal

เพิ่ม/แก้ API route และ UI ที่เรียกใช้ ให้ตรงสถาปัตยกรรมเดิมของโปรเจกต์ ปลอดภัย (สิทธิ์ + validate + parameterized SQL) และมีเทสต์ยืนยัน

# Instructions

1. **อ่านก่อนเขียน**
   - route ที่ใกล้เคียงใน `app/api/` (เช่น `app/api/reconcile/unsuspend/route.ts`, `app/api/master/work-roles/route.ts`)
   - helper ใน `lib/` ที่เกี่ยวข้อง: `db.ts` (`getPool`), `session.ts` (`requireRole`), `roles.ts`, `apiInput.ts`, `periodClose.ts`
   - Next.js 16 ต่างจากเวอร์ชันเก่า — ถ้าใช้ API ของ Next ที่ไม่แน่ใจ ให้อ่าน `node_modules/next/dist/docs/` ก่อน
2. **วางไฟล์** — `app/api/<โดเมน>/<ทรัพยากร>/route.ts` (kebab-case) export เฉพาะ method ที่ใช้ (`GET`/`POST`/`PUT`/`DELETE`)
3. **โครง handler มาตรฐาน**
   ```ts
   export async function POST(req: NextRequest) {
     const auth = await requireRole(RECONCILE_ROLES);   // บรรทัดแรกเสมอ (ADMIN_ROLES / VIEWER_ROLES ตามงาน)
     if (!auth.ok) return auth.response;
     try {
       // 1) validate ด้วย lib/apiInput.ts: parseIdParam, parseIsoDateParam, parseDateRange, badRequest(...)
       // 2) const pool = await getPool();
       // 3) งานเขียนหลายคำสั่ง → new sql.Transaction(pool) + begin/commit/rollback
       // 4) ทุกค่าจากผู้ใช้ผ่าน .input('name', sql.Type, value) เท่านั้น
       // 5) งานที่กระทบวันที่ในงวด → เช็คงวดปิดด้วย assertDatesOpen (lib/periodClose.ts)
       return NextResponse.json({ ...result });
     } catch (err) {
       // ตอบ { error: 'ข้อความภาษาไทยที่ผู้ใช้อ่านเข้าใจ' } + status ที่เหมาะสม ไม่ส่ง error ดิบของ mssql
     }
   }
   ```
4. **ตรรกะธุรกิจ** แยกเป็นฟังก์ชันล้วนใน `lib/<ชื่อเรื่อง>.ts` (camelCase) เพื่อให้เทสต์ได้โดยไม่ต้องต่อ DB
   ส่วน SQL ที่ใช้ซ้ำวางใน `lib/<เรื่อง>Db.ts`
5. **ถ้าต้องใช้ตาราง/คอลัมน์ใหม่** ให้ทำ skill `db-migration` ก่อน และให้ route ตรวจว่ารัน migration แล้ว
   (แบบ `xxxReady()` + ตอบ 409 พร้อมบอกชื่อไฟล์ migration ที่ต้องรัน)
6. **UI** — component ของหน้าวางที่ `app/<หน้า>/components/` เรียก API ด้วย `fetch('/api/...')`
   แสดงสถานะ loading / error (ข้อความไทยจาก `error`) / ข้อมูล
7. **เทสต์** — `tests/<ชื่อเรื่อง>Api.test.ts` (camelCase เหมือนไฟล์เดิม) ใช้ `vi.mock('mssql')`, `vi.mock('../lib/db')`,
   `vi.mock('../lib/session')` แล้วเรียก handler ตรง ๆ ด้วย `new NextRequest(...)` (ดูแบบอย่าง `tests/workRolesApi.test.ts`)
   ครอบคลุมอย่างน้อย: ไม่มีสิทธิ์ (401/403 และไม่แตะ DB) · input ผิด (400) · สำเร็จ · error ระหว่าง transaction → rollback
8. ยืนยันด้วย skill `verify-changes`

# Constraints

- ห้ามต่อ DB จาก page/component ฝั่ง client — ทุกอย่างผ่าน `app/api/**`
- ห้ามต่อ string SQL จากค่าที่ผู้ใช้ส่งมา
- ห้ามแก้ข้อมูล bank statement line ที่นำเข้าแล้วให้ผิดกฎ immutable · ห้ามเขียนในงวดที่ปิดแล้ว
- import ในโปรเจกต์นี้ใช้ relative path (`../../../../lib/...`) ตามไฟล์เดิม — ทำให้สอดคล้องกับไฟล์รอบข้าง
- ห้ามเพิ่ม dependency ใหม่โดยไม่ถามผู้ใช้
- ความรู้เชิงโดเมน (matching, offset, suspense, period workflow): skill `auto-recon-expert`
