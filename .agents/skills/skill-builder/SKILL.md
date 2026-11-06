---
name: skill-builder
description: >-
  Meta-skill for creating or updating Antigravity skills in this project. Use whenever the user asks
  to create, add, convert, or edit a skill, command, workflow, playbook, or runbook for the agent
  (e.g. "สร้าง skill", "เพิ่ม command", "ทำ workflow ใหม่", "แปลง slash command เป็น skill").
---

# Goal

สร้าง Skill ใหม่ (หรือแก้ Skill เดิม) ให้อยู่ในรูปแบบมาตรฐานเดียวกันทั้งโปรเจกต์ เพื่อให้ Antigravity ค้นเจอและดึงมาใช้ได้ถูกจังหวะ:
ไฟล์เดียวต่อ skill ที่ `.agents/skills/<skill-name>/SKILL.md` มี YAML frontmatter (`name`, `description`) และเนื้อหา `# Goal` / `# Instructions` / `# Constraints`

# Instructions

1. **เก็บความต้องการ** — ถามผู้ใช้ (ถ้ายังไม่ชัด) ให้ได้ 3 อย่าง:
   - skill นี้ทำงานอะไร (ผลลัพธ์ที่ต้องได้)
   - ผู้ใช้จะพูดว่าอะไรตอนต้องการ skill นี้ (คำ trigger ทั้งไทย/อังกฤษ)
   - มีข้อห้าม/ไฟล์/คำสั่งเฉพาะของโปรเจกต์ที่ต้องใช้ไหม
2. **เช็คของเดิมก่อน** — `ls .agents/skills/` แล้วอ่าน `SKILL.md` ที่ชื่อ/หน้าที่ใกล้เคียง
   ถ้ามี skill ที่ครอบคลุมอยู่แล้ว ให้เสนอแก้ skill เดิมแทนการสร้างซ้ำ
3. **ตั้งชื่อ** — `name` เป็นตัวพิมพ์เล็ก คั่นด้วยขีด (kebab-case) เช่น `db-migration`, `verify-changes`
   ชื่อโฟลเดอร์ต้องตรงกับ `name` ทุกตัวอักษร
4. **เขียน description ให้ trigger ได้** — บอกให้ครบว่า "ทำอะไร" + "ใช้เมื่อผู้ใช้สั่งเรื่องอะไร"
   ใส่คำที่ผู้ใช้น่าจะพิมพ์จริง (ไทยและอังกฤษ) ยาวไม่เกิน ~3 บรรทัด
5. **อ่านโค้ดจริงก่อนเขียนขั้นตอน** — ทุกคำสั่ง (`npm run …`, path, ชื่อฟังก์ชัน) ต้องมีอยู่จริงในโปรเจกต์
   ตรวจจาก `package.json` / ไฟล์จริง ห้ามเดา
6. **สร้างไฟล์** `.agents/skills/<skill-name>/SKILL.md` ตามแม่แบบนี้:

   ```markdown
   ---
   name: <skill-name>
   description: <ทำอะไร + ใช้เมื่อผู้ใช้สั่งงานเกี่ยวกับอะไร>
   ---

   # Goal
   <ผลลัพธ์ที่ skill นี้ต้องส่งมอบ 1–3 ประโยค>

   # Instructions
   1. <ขั้นตอนที่ทำได้จริง ระบุไฟล์/คำสั่งชัดเจน>
   2. ...
   N. ตรวจผลด้วยคำสั่งจริงแล้วรายงานผลตามจริง

   # Constraints
   - <สิ่งที่ห้ามทำ / ขอบเขต / ต้องขออนุญาตผู้ใช้ก่อน>
   ```

7. ถ้าเนื้อหายาว (เกิน ~200 บรรทัด) ให้แยกรายละเอียดไปไว้ที่ `.agents/skills/<skill-name>/references/*.md`
   แล้วลิงก์จาก `SKILL.md` แบบ relative (`./references/xxx.md`)
8. **ตรวจความถูกต้อง** หลังสร้าง:
   - `head -5 .agents/skills/<skill-name>/SKILL.md` → บรรทัดแรกต้องเป็น `---` และมี `name:` กับ `description:`
   - ชื่อโฟลเดอร์ == ค่า `name`
   - path และคำสั่งทุกตัวใน skill มีอยู่จริง
9. สรุปให้ผู้ใช้: path ของไฟล์ที่สร้าง/แก้ + trigger ที่ใช้เรียก skill

# Constraints

- 1 skill = 1 โฟลเดอร์ = 1 `SKILL.md` วางใน `.agents/skills/` เท่านั้น (ไม่วางที่อื่น)
- frontmatter ต้องอยู่บรรทัดแรกสุดของไฟล์ มีอย่างน้อย `name` และ `description`
- ห้ามแก้หรือลบ skill อื่นที่ผู้ใช้ไม่ได้สั่ง ถ้าเห็นว่าควรแก้ ให้บอกผู้ใช้ก่อนแล้วรอยืนยัน
- ห้ามใส่ความลับ (รหัสผ่าน, token, ค่าใน `.env*`) ลงใน skill
- ห้ามแก้ block `<!-- BEGIN:nextjs-agent-rules -->` ใน `AGENTS.md` (ถ้ามี) เพราะ `next dev` เขียนทับเอง
- เขียนให้กระชับ เป็นขั้นตอนที่ทำตามได้ทันที ไม่ต้องอธิบายทฤษฎียาว
