---
name: verify-changes
description: >-
  Run the real quality gates (ESLint, TypeScript type check, Vitest, Next.js build) for the Auto Reconcile
  Bank web-app and report the actual results. Use when the user asks to run tests, check types, lint,
  build, "เช็คโค้ด", "รันเทสต์", "เช็ค type", "ตรวจว่าพังไหม", or before declaring any code change done.
---

# Goal

ยืนยันด้วยผลลัพธ์จริงว่าโค้ดหลังแก้ ผ่าน lint · type check · unit test · build ครบ แล้วรายงานผลตามจริง (ผ่าน/ไม่ผ่าน พร้อม error ที่เจอ)

# Instructions

1. ทำงานที่ root ของโปรเจกต์ (`Auto recon/web-app/`)
2. รันตามลำดับ หยุดแก้ทันทีเมื่อขั้นไหนพัง แล้วค่อยรันขั้นนั้นซ้ำ:
   ```bash
   npm run lint              # ESLint 9 (eslint.config.mjs)
   npx tsc --noEmit          # โปรเจกต์นี้ไม่มี script typecheck — ใช้ tsc ตรง ๆ
   npm test                  # vitest run — unit test ใน tests/**/*.test.ts (ไม่ต่อ DB จริง)
   npm run build             # next build — รันเมื่อแก้ route/page/config หรือก่อนส่งงาน
   ```
3. ถ้าแก้เฉพาะเรื่องเดียว รันเทสต์ไฟล์ที่เกี่ยวข้องก่อนเพื่อความเร็ว แล้วค่อยรันทั้งชุด:
   ```bash
   npx vitest run tests/periodWorkflowApi.test.ts
   ```
4. ถ้าเทสต์พัง: อ่าน error จริง → หาสาเหตุในโค้ด (ไม่ใช่แก้เทสต์ให้ผ่าน) → แก้ → รันซ้ำ
   ถ้าเชื่อว่าเทสต์เดิมผิดจริง ให้แจ้งผู้ใช้พร้อมเหตุผลก่อนแก้เทสต์
5. ถ้าต้องดูหน้าเว็บจริง: ใช้ dev server ที่ผู้ใช้เปิดไว้ (พอร์ต 3000 จาก `.claude/launch.json`) ถ้ายังไม่มีค่อยรัน `npm run dev`
6. รายงานผลแบบตาราง: คำสั่ง · ผล (✅/❌) · จำนวนเทสต์ผ่าน/ตก · error สำคัญ (ถ้ามี)

# Constraints

- ห้ามบอกว่า "เสร็จ/ผ่าน" ถ้ายังไม่ได้รันคำสั่งจริง หรือผลยังมี error
- ห้ามปิดหรือ skip เทสต์ (`it.skip`, `--passWithNoTests` ฯลฯ) เพื่อให้ผ่าน
- vitest ห้ามต่อฐานข้อมูลจริง — เทสต์ต้อง mock `mssql`, `lib/db`, `lib/session` (ดู `vitest.config.ts`)
- ห้ามฆ่า process ของ dev server ที่ผู้ใช้เปิดค้างไว้
- ห้ามแก้ block `nextjs-agent-rules` ใน `AGENTS.md`
- Next.js 16 มี breaking changes — ถ้า build error เกี่ยวกับ API ของ Next ให้อ่าน `node_modules/next/dist/docs/` ก่อนแก้
