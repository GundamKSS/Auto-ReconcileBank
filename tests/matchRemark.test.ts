import { describe, it, expect } from 'vitest';
import { remarkProblem, REMARK_MIN_LENGTH, REMARK_MAX_LENGTH } from '../lib/matchRemark';

describe('remarkProblem — กติกาหมายเหตุของการจับคู่', () => {
  it('ผ่านเมื่อหมายเหตุอธิบายเหตุผลได้จริง', () => {
    expect(remarkProblem('ธนาคารกลับรายการเอง 17/08 ทีมบัญชีตั้ง JV ปรับปรุง')).toBeNull();
  });

  it('ไม่ผ่านเมื่อพิมพ์ให้ผ่านๆ สั้นเกินไป', () => {
    for (const short of ['', '-', 'ok', 'โอน']) {
      expect(remarkProblem(short)).toBe(`กรุณาใส่หมายเหตุอย่างน้อย ${REMARK_MIN_LENGTH} ตัวอักษร`);
    }
  });

  it('นับความยาวหลังตัดช่องว่างหัวท้ายแล้ว — เคาะ space ให้ครบไม่นับว่าผ่าน', () => {
    expect(remarkProblem('  ok  ')).not.toBeNull();
  });

  it('ยาวเท่าขั้นต่ำพอดีถือว่าผ่าน', () => {
    expect(remarkProblem('x'.repeat(REMARK_MIN_LENGTH))).toBeNull();
  });

  it('ยาวเท่าเพดานพอดีถือว่าผ่าน แต่เกิน 1 ตัวไม่ผ่าน', () => {
    expect(remarkProblem('x'.repeat(REMARK_MAX_LENGTH))).toBeNull();
    expect(remarkProblem('x'.repeat(REMARK_MAX_LENGTH + 1))).toBe(
      `หมายเหตุยาวเกิน ${REMARK_MAX_LENGTH} ตัวอักษร`
    );
  });
});
