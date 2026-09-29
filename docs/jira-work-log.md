# Auto Reconcile Bank — Work Log สำหรับกรอก JIRA

**Project:** Auto Reconcile Bank (Web App) — ระบบกระทบยอดธนาคาร (Bank Reconciliation) ระหว่าง Bank Statement กับ GL (BC365)
**JIRA Epic:** ITS-2817 — Auto-reconcile Bank AR Phase I (Team: DEV) · Start 20 ก.ค. 2026 · Due 23 ก.ย. 2026
**Tech Stack:** Next.js 16 (App Router) + React 19 + TypeScript, Tailwind CSS 4, framer-motion, recharts, SheetJS (xlsx), MS SQL Server (mssql), TRW Data Center API
**Database:** Reconcile_Bank (MS SQL Server)
**ระยะเวลา:** 20 ก.ค. 2026 – ปัจจุบัน (Dev เสร็จแล้ว, อยู่ระหว่าง UAT)
**อัปเดตล่าสุด:** 23 ก.ย. 2026

## แผนที่ Work Item → JIRA Child Item
| Work Item | JIRA | สถานะปัจจุบัน |
|-----------|------|----------------|
| 1. Get Requirement | ITS-2819 | Done |
| 2. Analysis (Analyst) | ITS-2820 | Done |
| 3. Design | ITS-2821 | Done |
| 4. Dev | ITS-2822 | Done |
| 5. UAT | ITS-2824 | In Progress |
| 6. On Production | ITS-2825 | To Do |

---

# WORK ITEM 1 — Get Requirement (ITS-2819) — ✅ Done
**ระยะเวลา:** 20 – 27 ก.ค. 2026
**Description:** เก็บความต้องการจากฝ่ายบัญชี/การเงิน เรื่องการกระทบยอดธนาคารกับ GL เพื่อทดแทนการทำมือด้วย Excel

### Subtasks
1. ประชุมเก็บ requirement กับฝ่ายบัญชี — ขั้นตอนการกระทบยอดปัจจุบัน (as-is process)
2. รวบรวมไฟล์ Bank Statement ตัวอย่างจากธนาคารที่ใช้งาน (KBANK, SCB, BBL) และศึกษารูปแบบไฟล์แต่ละธนาคาร
3. เก็บ requirement ข้อมูลฝั่ง GL — วิธีดึงข้อมูลจาก Business Central 365 (BC365)
4. กำหนดกติกาการจับคู่ (matching rule) — จับคู่ด้วยวันที่ / จำนวนเงิน / เลขที่เอกสาร, รองรับ many-to-many
5. เก็บ requirement รายงานที่ต้องใช้ — รายงานสรุปรายเดือน, รายการค้าง (outstanding), export Excel
6. กำหนดสิทธิ์ผู้ใช้งานและ role ที่ต้องมี (Admin / User / Dev)
7. สรุปขอบเขตงาน (scope) และ requirement sign-off

---

# WORK ITEM 2 — Analysis (ITS-2820) — ✅ Done
**ระยะเวลา:** 28 ก.ค. – 3 ส.ค. 2026
**Description:** วิเคราะห์ requirement เป็น functional spec, data flow และเลือกเทคโนโลยี

### Subtasks
1. วิเคราะห์ as-is / to-be process ของการกระทบยอด และจุดที่ระบบจะเข้ามาทดแทน
2. วิเคราะห์โครงสร้างไฟล์ Bank Statement แต่ละธนาคาร (header, column, format วันที่/จำนวนเงิน) เพื่อออกแบบ parser
3. วิเคราะห์ data flow: Import → Staging → Reconcile → Match/Suspense → Report
4. วิเคราะห์การเชื่อมต่อระบบภายนอก — BC365 (GL) และ TRW Data Center API (Authentication)
5. วิเคราะห์สถานะของรายการ (status) — Unmatched / Matched / Suspense / Reversed และเงื่อนไขการเปลี่ยนสถานะ
6. วิเคราะห์ข้อกำหนดด้าน audit — ต้องเก็บประวัติการ match / unmatch ใครทำเมื่อไหร่
7. เลือก tech stack และประเมินงาน (Next.js + MS SQL Server) สรุปเป็น functional specification

---

# WORK ITEM 3 — Design (ITS-2821) — ✅ Done
**ระยะเวลา:** 4 – 9 ส.ค. 2026
**Description:** ออกแบบฐานข้อมูล, สถาปัตยกรรมระบบ, API และ UI/UX

### Subtasks
1. ออกแบบฐานข้อมูล Reconcile_Bank — ตาราง bank statement (import batch + line), GL line, match group, suspense, audit log
2. ออกแบบ SQL View สำหรับรายงาน (vw_ReconciliationDetailReport)
3. ออกแบบ script migration สำหรับ match reversal (SQL 002, 003)
4. ออกแบบ architecture ของแอป — Next.js App Router, โครงสร้าง app/ api/ lib/ components/ hooks/
5. ออกแบบ API contract ทั้งหมด (auth, import, reconcile, suspense, report, dashboard)
6. ออกแบบ UI/UX — Sidebar + workspace layout, หน้าจอ Login, Import, Master Data, Reconcile, Suspense, Reports, Dashboard
7. ออกแบบหน้าจอ Reconcile แบบ 2 ฝั่ง (Bank / GL) และ flow การเลือกจับคู่
8. ออกแบบ security & role matrix — เมนู/สิทธิ์ที่แต่ละ role เข้าถึงได้

---

# WORK ITEM 4 — Dev (ITS-2822) — ✅ Done
**ระยะเวลา:** 10 ส.ค. – 22 ก.ย. 2026 (ขยายจากแผนเดิม เพราะมีรอบปรับปรุงตาม feedback)
**Description:** พัฒนาระบบตาม design แบ่งเป็นรอบ (iteration) ทีละโมดูล

### Subtasks

**Setup & Authentication**
1. ตั้งโครงโปรเจกต์ Next.js + TypeScript + Tailwind CSS และวางโครงสร้างโฟลเดอร์
2. พัฒนาการเชื่อมต่อฐานข้อมูล MS SQL Server ด้วย connection pool (lib/db.ts)
3. พัฒนาหน้า Login และ API login พร้อมจัดการ session
4. พัฒนา AuthGuard / RouteGuard ป้องกันการเข้าหน้าโดยไม่ login
5. พัฒนา auto logout เมื่อไม่มีการใช้งาน (useInactivityLogout)
6. ปรับการยืนยันตัวตนไปใช้ TRW Data Center API แทนตาราง Employee

**Import Module**
7. พัฒนาหน้า Import และ flow อัปโหลดไฟล์ (ImportFlow)
8. พัฒนา parser Bank Statement ธนาคาร KBANK
9. พัฒนา parser Bank Statement ธนาคาร SCB
10. พัฒนา parser Bank Statement ธนาคาร BBL
11. พัฒนา API preview ข้อมูลก่อน import และ API import จริง (กันข้อมูลซ้ำ, บันทึกเป็น import batch)
12. พัฒนา GL sync จาก BC365 และแยก endpoint sync GL เป็น 2 ตัว (import / reconcile)
13. พัฒนาหน้า Master Data — Bank Statement: ดูรายการ import, ดู/แก้ line item, filter + pagination

**Reconciliation Module (โมดูลหลัก)**
14. พัฒนาหน้า Reconcile workspace แบบ 2 ฝั่ง (Bank / GL) + New Reconciliation modal
15. พัฒนาการเลือกจับคู่ระดับ line รองรับ many-to-many พร้อมการจัดกลุ่ม (match group)
16. พัฒนา auto-suggest คู่ที่น่าจะตรงกัน พร้อม preview modal ก่อนยืนยัน
17. พัฒนา API บันทึกผลการ match พร้อมเลขกลุ่ม
18. พัฒนา Unmatch (ยกเลิกการจับคู่) พร้อม audit trail และแก้ปัญหาเลขกลุ่มข้ามฝั่ง
19. พัฒนาการคงสถานะ session การกระทบยอดข้าม reload (เคลียร์เมื่อ logout หรือเริ่มรอบใหม่)

**Suspense Module**
20. พัฒนาหน้า Suspense workspace และฟังก์ชัน Unsuspend
21. พัฒนาการเลือกรายการระดับ line และ bulk revert พร้อม confirm modal
22. บังคับกติกา: พักรายการได้เฉพาะฝั่ง GL/BC365 เท่านั้น ฝั่ง Bank Statement ห้ามแก้
23. พัฒนา aging badge และ filter รายการค้าง

**Report & Dashboard**
24. สร้าง SQL View สำหรับรายงานรายละเอียดการกระทบยอด
25. พัฒนาหน้า Reports สรุปรายเดือน พร้อม export Excel
26. พัฒนา Dashboard จากข้อมูลจริง — KPI cards, status donut, daily/trend chart, aging, outstanding list, bank breakdown
27. พัฒนาหน้า Match History แสดงรายการ Bank/GL ในตารางเดียว

**Security & Maintenance**
28. ย้ายฐานข้อมูลแอปไปที่ Reconcile_Bank
29. แก้ช่องโหว่ severity สูงของ next, sharp, xlsx (upgrade + pin xlsx จาก SheetJS CDN)
30. พัฒนาระบบสิทธิ์เมนูตาม role (Admin / User / Dev) จาก session
31. Unit test / self-test แต่ละโมดูล และแก้ bug ที่พบระหว่างพัฒนา

**รอบเพิ่มเติม (ก.ย. 2026) — ปรับปรุงตาม feedback ระหว่างพัฒนา/พิสูจน์ยอดจริง**
32. แยก action IN/OUT บนหน้า Reconcile, badge IN สีม่วง และ compact focus mode
33. ตัดรายการที่ถูก reverse ออกจากสรุปการกระทบยอดใน Dashboard/Reports
34. จำกัดสิทธิ์หน้า Reconcile / Match History / Suspense ให้เฉพาะ Admin/Dev
35. ย้ายระบบ auth มาฝั่ง server (session/roles/logout) — ต้องตั้ง SESSION_SECRET บนเครื่อง deploy
36. เพิ่มการลบไฟล์ Bank Statement ทั้งไฟล์แบบ soft delete (SQL 005) บนหน้า Master Data
37. กระทบยอดแยกตาม "เลขบัญชี" ไม่ใช่แค่แยกตามธนาคาร (SQL 006)
38. เปลี่ยน Suggest matches เป็น "ผู้ช่วยหาคู่" (rule-based) และปิดช่องโหว่ GL ถูกจับคู่ซ้ำ
39. แก้การกดจับคู่ข้ามวันที่ (cross-day matching)
40. เพิ่มการปรับยอด GL (GL adjustment) และรองรับรายการหักล้างกันเอง (MatchType OFFSET/REVERSAL)
41. เพิ่มหน้า Master Data GL (อ่านอย่างเดียว) พร้อม JOIN mapping ตัดบัญชีที่ไม่ใช่ธนาคารออก
42. ปรับหน้า Match History ให้ครบทุกประเภทการจับคู่ + กรองตามวันที่ GL + ค้นหากว้างขึ้น
43. พิสูจน์ยอดคงเหลือ Bank = GL, remark การจับคู่ต่างยอด, ยอดพักโอน (SQL 007) และเพิ่มชุด unit test (vitest)

---

# WORK ITEM 5 — UAT (ITS-2824) — 🔵 In Progress
**ระยะเวลา:** ก.ย. 2026 – ปัจจุบัน (อยู่ระหว่างดำเนินการ)
**Description:** ทดสอบระบบร่วมกับผู้ใช้งานจริง (ฝ่ายบัญชี) ด้วยข้อมูลจริง — feedback บางส่วน (เช่น การพิสูจน์ยอด Bank=GL 17 ก.ย. และเคสกระดาษทำมือ BBL4633) ถูก loop กลับไปแก้ในรอบ Dev เพิ่มเติมแล้ว

### Subtasks
1. เตรียม test environment และ test data (Bank Statement จริง 3 ธนาคาร + GL จริงจาก BC365)
2. จัดทำ UAT test case ครอบคลุมทุกโมดูล (Login, Import, Reconcile, Suspense, Report, Dashboard)
3. UAT — Login และสิทธิ์ตาม role (Admin / User / Dev)
4. UAT — Import Bank Statement ทั้ง 3 ธนาคาร และ sync GL จาก BC365
5. UAT — การจับคู่ (match), auto-suggest และการยกเลิกการจับคู่ (unmatch)
6. UAT — Suspense: พักรายการ, revert, aging
7. UAT — ตรวจสอบความถูกต้องของรายงานและ Excel export เทียบกับการทำมือ
8. UAT — Dashboard และ Match History
9. รวบรวม feedback / issue จากผู้ใช้ และแก้ไข (bug fix round)
10. Re-test หลังแก้ไข และ UAT sign-off

---

# WORK ITEM 6 — On Production (ITS-2825) — ⚪ To Do
**ระยะเวลา:** หลัง UAT sign-off
**Description:** นำระบบขึ้นใช้งานจริงบน Windows Server พร้อมส่งมอบคู่มือ (โครงสร้าง server/NSSM เตรียมไว้แล้ว รอ sign-off เพื่อ go-live เต็มรูปแบบ)

### Subtasks
1. เตรียม production server (Windows Server) และติดตั้ง Node.js runtime
2. Setup production database Reconcile_Bank และรัน SQL migration/view ทั้งหมด
3. Deploy source ไปที่ C:\Project\Auto-ReconcileBank (server เป็น pull-only จาก git)
4. ติดตั้งแอปเป็น Windows Service ด้วย NSSM รันที่พอร์ต 8080
5. ตั้งค่า environment / connection string / API endpoint สำหรับ production
6. Smoke test บน production หลัง deploy
7. จัดทำคู่มือการใช้งานภาษาไทย (HTML + PDF) ครอบคลุมทุกหน้าจอ
8. อบรมการใช้งานและส่งมอบระบบให้ผู้ใช้
9. สำรอง source archive (app / components / lib / hooks)
10. Monitoring & support หลัง go-live

---

## สรุป Deliverables
- เว็บแอปหน้าจอหลัก: Login, Import, Master Data (Bank Statement + GL), Reconcile, Suspense, Reports/Match History, Dashboard
- REST API หลายกลุ่ม: auth, import, bank-statement, master, reconcile, history, reports, dashboard
- Parser Bank Statement 3 ธนาคาร (KBANK, SCB, BBL) + BC365 GL sync
- SQL migration/view: 002–007 + vw_ReconciliationDetailReport (match reversal, soft delete, แยกเลขบัญชี, remark/opening balance) + audit trail การ match/unmatch
- รองรับการจับคู่ many-to-many, ข้ามวัน, ผู้ช่วยหาคู่, รายการหักล้าง (OFFSET/REVERSAL), พิสูจน์ยอด Bank=GL
- ชุด unit test (vitest) ครอบคลุม parser/บัญชี/บทบาท/session/การจับคู่
- คู่มือผู้ใช้ภาษาไทย (HTML + PDF)
- ระบบใช้งานจริงบน Windows Server (NSSM service, port 8080)
