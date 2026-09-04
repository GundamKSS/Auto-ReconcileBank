# Auto Reconcile Bank — ช่วงวันเวลาสำหรับกรอก JIRA

## ตารางหลัก (6 Work Items)

| # | Work Item | Start date | Due date | ระยะเวลา | สถานะ |
|---|-----------|-----------|----------|----------|-------|
| 1 | Get Requirement | จ. 20 ก.ค. 2026 | ศ. 24 ก.ค. 2026 | 1 สัปดาห์ (5 วันทำการ) | Done |
| 2 | Analysis        | จ. 27 ก.ค. 2026 | ศ. 31 ก.ค. 2026 | 1 สัปดาห์ (5 วันทำการ) | Done |
| 3 | Design          | จ. 3 ส.ค. 2026  | ศ. 7 ส.ค. 2026  | 1 สัปดาห์ (5 วันทำการ) | Done |
| 4 | Dev             | จ. 10 ส.ค. 2026 | ศ. 4 ก.ย. 2026  | 4 สัปดาห์ (20 วันทำการ) | In Progress |
| 5 | UAT             | จ. 7 ก.ย. 2026  | ศ. 18 ก.ย. 2026 | 2 สัปดาห์ (10 วันทำการ) | To Do (แผน) |
| 6 | On Production   | จ. 21 ก.ย. 2026 | อ. 30 ก.ย. 2026 | 1.5 สัปดาห์ (8 วันทำการ) | To Do (แผน) |

**รวมทั้งโครงการ: 20 ก.ค. – 30 ก.ย. 2026 (~10.5 สัปดาห์)**
ทุกช่วงเริ่มวันจันทร์ จบวันศุกร์ ไม่คร่อมเสาร์-อาทิตย์

---

## วันที่ระดับ Subtask (Work Item 4 — Dev) — อิงจาก git log จริง

| ช่วงงาน | วันที่จริง | สิ่งที่ทำ |
|---------|-----------|-----------|
| Setup + Auth + Import + Reconcile รอบแรก | จ. 10 ส.ค. 2026 | วางโครงโปรเจกต์, login, import, หน้า reconcile |
| GL Sync + SCB + Master Data | พฤ. 13 ส.ค. 2026 | BC365 GL sync, parser SCB, filter/pagination Master Data |
| Suspense Module | อ. 18 ส.ค. 2026 | หน้า Suspense, unsuspend, bulk revert, SQL view รายงาน |
| Reports + Dashboard + Security | จ. 24 ส.ค. 2026 | หน้า Reports + Excel export, Dashboard ข้อมูลจริง, ย้าย DB เป็น Reconcile_Bank, TRW API auth, patch ช่องโหว่ |
| Unmatch + Match History + Role + คู่มือ | อ. 25 ส.ค. 2026 | Unmatch + audit trail, Match History ตารางเดียว, role-based menu, คู่มือภาษาไทย |
| แก้ API Login | พ. 26 ส.ค. 2026 | ปรับ API login |
| IN/OUT + Report fix + จำกัดสิทธิ์ + เอกสาร | พ. 2 ก.ย. 2026 | แยก action IN/OUT, ตัด reversed match ออกจากรายงาน, จำกัดสิทธิ์ Admin/Dev, เอกสารสถาปัตยกรรม |
| ย้าย auth มาฝั่ง server (session/roles/logout) | พฤ. 3 ก.ย. 2026 | กำลังทำอยู่ — ยังไม่ commit |

---

## หมายเหตุก่อนกรอก

- **Work Item 1–3 (Requirement / Analysis / Design):** git มี commit แรก 20 ก.ค. แล้วเว้นว่างถึง 10 ส.ค. — ช่วง 3 สัปดาห์นี้จึงถูกจัดให้เป็นงาน Requirement/Analysis/Design ซึ่งเป็นช่วงที่ไม่มีโค้ด **ถ้าจำวันประชุมจริงได้ ควรแก้ให้ตรง**
- **Work Item 4 (Dev):** วันที่ทั้งหมดเป็นวันจริงจาก git ยังทำงานอยู่ ณ 3 ก.ย. 2026 (งาน server-side session ยังไม่ commit) จึงตั้ง due date ไว้ ศ. 4 ก.ย. 2026
- **Work Item 5–6 (UAT / On Production):** **ยังไม่เกิดขึ้นจริง** วันที่เป็นแผนที่ประมาณไว้ ต้องยืนยันกับผู้ใช้/ฝ่ายบัญชีก่อนล็อกลง JIRA
