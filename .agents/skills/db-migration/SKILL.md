---
name: db-migration
description: >-
  Create a new SQL Server migration script in sql/NNN_*.sql for the Reconcile_Bank database (new table,
  column, index, view) following the project's idempotent, transactional style. Use when the user asks to
  "เพิ่มตาราง", "เพิ่มคอลัมน์", "แก้ schema", "ทำ migration", change the database structure, or a feature needs new DB objects.
---

# Goal

สร้างไฟล์ migration ใหม่ที่รันซ้ำได้ปลอดภัย (idempotent) อยู่ใน transaction และโค้ดฝั่งแอปรองรับช่วงที่ยังไม่ได้รัน migration

# Instructions

1. ดูเลขล่าสุด: `ls sql/` → ไฟล์ใหม่ใช้เลขถัดไป 3 หลัก เช่น `013_<ชื่อเรื่อง_snake_case>.sql`
2. เปิดไฟล์ล่าสุด (เช่น `sql/012_bank_account_status.sql`) เป็นแม่แบบ แล้วเขียนตามโครงนี้:
   ```sql
   /* =====================================================================
      013 — <เรื่อง>
      <ใช้ทำอะไร / หน้าไหนใช้ / ก่อนรันแอปจะตอบอะไร>
      รันได้ซ้ำ — ทุกคำสั่งมี guard
      ===================================================================== */
   SET XACT_ABORT ON;
   BEGIN TRANSACTION;

   IF OBJECT_ID('dbo.<ตารางที่ต้องมีอยู่ก่อน>', 'U') IS NULL
     THROW 50000, 'ไม่พบตาราง dbo.<...>', 1;

   IF COL_LENGTH('dbo.<ตาราง>', '<คอลัมน์>') IS NULL
     ALTER TABLE dbo.<ตาราง> ADD <คอลัมน์> <ชนิด> NULL;

   IF OBJECT_ID('dbo.<ตารางใหม่>', 'U') IS NULL
     CREATE TABLE dbo.<ตารางใหม่> ( ... );

   COMMIT TRANSACTION;
   ```
   - คอลัมน์ `NOT NULL` ที่เพิ่มในตารางมีข้อมูลแล้ว ต้องมี `CONSTRAINT DF_<ตาราง>_<คอลัมน์> DEFAULT (...)`
   - ตั้งชื่อ constraint/index ชัดเจน (`PK_`, `FK_`, `IX_`, `DF_`)
3. ฝั่งแอป: เพิ่มฟังก์ชันตรวจความพร้อมใน `lib/<เรื่อง>Db.ts` แบบเดียวกับ `bankAccountColumnsReady()` / `workRolesReady()`
   (cache ผลเมื่อพร้อมแล้ว) แล้วให้ route ตอบ 409 + ข้อความบอกชื่อไฟล์ migration เมื่อยังไม่พร้อม
4. ถ้าแก้ view (`sql/vw_*.sql`) ใช้ `CREATE OR ALTER VIEW`
5. ตรวจ syntax ด้วยการอ่านทวนเอง และเทสต์ฝั่งแอปด้วย mock (ห้ามต่อ DB จริงใน vitest) → skill `verify-changes`
6. บอกผู้ใช้ชัดเจนว่า **ต้องรันไฟล์ไหน กับฐานข้อมูลไหน** (`Reconcile_Bank`) และผลกระทบ — ให้ผู้ใช้เป็นคนรันเอง

# Constraints

- **ห้ามแก้ไฟล์ migration ที่มีอยู่แล้ว** (002–012 รันบน DB จริงไปแล้ว) — สร้างไฟล์เลขใหม่เสมอ
- ห้ามรัน SQL กับฐานข้อมูลจริง (`sqlcmd`, script ต่อ DB) เองโดยผู้ใช้ไม่ได้สั่ง
- ห้าม `DROP` ตาราง/คอลัมน์ หรือ `DELETE`/`UPDATE` ข้อมูลจำนวนมาก โดยไม่แจ้งผลกระทบและรอผู้ใช้ยืนยัน
- ห้ามเขียนตารางที่ sync มาจาก BC365 (`BankAccountLedgerEntries` ฯลฯ) นอกเหนือจาก flow sync เดิม
- ห้ามใส่ค่าความลับลงในไฟล์ SQL
