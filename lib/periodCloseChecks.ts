import { formatAmount } from './formatAmount';

/**
 * เงื่อนไขปิดงวดตาม docs/spec-matching-period-close.md (ร่าง 30 ต.ค. 2569)
 *
 * โหมดที่ใช้ตอนนี้คือ "เตือนก่อน ยังปิดงวดได้" ตามที่ตกลงไว้ ฟังก์ชันนี้จึงแค่คำนวณผลการตรวจ
 * ส่งให้หน้าจออ่าน ไม่ได้บล็อกการยืนยันงานหรือการปิดงวด ด่านจริงยังเป็นชุดเดิมใน
 * lib/periodCloseDb.ts (ไม่มีงวดทับซ้อน, AP กับ AR ยืนยันครบ, fingerprint, ผลต่างหลังปรับปรุงเป็นศูนย์)
 * เมื่อทีมบัญชีใช้จริงแล้วเห็นว่าคำเตือนตรงกับงาน จึงค่อยเปลี่ยนข้อที่เลือกไว้เป็นเงื่อนไขบล็อก
 *
 * รับค่าที่คำนวณมาแล้วทั้งหมด ไม่ต่อฐานข้อมูลเอง เพื่อให้เทสต์ได้ตรงๆ (tests/periodCloseChecks.test.ts)
 * ข้อที่ยังตรวจไม่ได้เพราะไม่มีที่เก็บข้อมูล จะคืน level unknown พร้อมบอกว่าต้องมีอะไรก่อน
 * ไม่ซ่อนไว้ เพื่อให้เห็นว่าสเปกยังเหลือข้อไหน
 */

const EPS = 0.005;

export type CheckLevel = 'ok' | 'warn' | 'unknown';

export type PeriodCheck = {
  /** เลขข้อในสเปก เช่น "46 ก" */
  item: string;
  /** ฝั่งที่ต้องรับผิดชอบข้อนี้ null คือทั้งงวด */
  direction: 'IN' | 'OUT' | null;
  level: CheckLevel;
  title: string;
  detail: string;
};

export type SideCount = { count: number; net: number };

export type PeriodCheckInput = {
  period: { from: string; to: string };
  bank: {
    opening: number | null;
    closing: number | null;
    statementClosing: number | null;
    chainOk: boolean;
    lineCount: number;
    /** วันที่ของรายการสุดท้ายในไฟล์ แยกตามฝั่ง null คือยังไม่มีรายการฝั่งนั้น */
    lastDateIn: string | null;
    lastDateOut: string | null;
  };
  gl: { opening: number | null };
  /** รายการธนาคารที่ยังไม่จับคู่ แยกตามฝั่ง */
  bankUnmatched: { IN: SideCount; OUT: SideCount };
  /** งวดก่อนที่ปิดแล้วและอยู่ติดกับงวดนี้ null คือยังไม่มี */
  previousClose: { periodEnd: string; bankClosing: number | null; glClosing: number | null } | null;
};

export function formatDMY(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

const sideLabel = (direction: 'IN' | 'OUT') => (direction === 'IN' ? 'เงินเข้า' : 'เงินออก');

/** ข้อ 11 กับ 46 ก ธนาคารต้องไม่เหลือรายการรอจับคู่ ก่อนฝั่งนั้นยืนยันงาน */
function bankUnmatchedCheck(direction: 'IN' | 'OUT', side: SideCount): PeriodCheck {
  const label = sideLabel(direction);
  if (side.count === 0) {
    return {
      item: '46 ก',
      direction,
      level: 'ok',
      title: `ธนาคาร${label} จับคู่ครบแล้ว`,
      detail: 'ทุกบรรทัดของธนาคารฝั่งนี้มีคู่ใน BC365 แล้ว',
    };
  }
  return {
    item: '46 ก',
    direction,
    level: 'warn',
    title: `ธนาคาร${label} ยังรอจับคู่ ${side.count} รายการ`,
    detail:
      `ยอดรวม ${formatAmount(Math.abs(side.net))} บาท ตามสเปกต้องจับคู่ให้ครบก่อนยืนยันงาน ` +
      'รายการที่หาใน BC365 ไม่เจอ ให้ลงใน BC365 ตามตารางหัวข้อ C แล้วดึงข้อมูลใหม่',
  };
}

/** ข้อ 33 กับ 46 ค ไฟล์ของฝั่งนั้นต้องนำเข้าถึงวันสิ้นงวด */
function coverageCheck(direction: 'IN' | 'OUT', lastDate: string | null, periodEnd: string): PeriodCheck {
  const label = sideLabel(direction);
  if (!lastDate) {
    return {
      item: '33',
      direction,
      level: 'warn',
      title: `ยังไม่มีรายการ${label}ในงวดนี้`,
      detail: `ถ้ายังไม่ได้นำเข้าไฟล์ฝั่งนี้ ให้นำเข้าก่อน ถ้าเดือนนี้ไม่มีรายการ${label}จริง ให้ระบุไว้ในหมายเหตุตอนยืนยันงาน`,
    };
  }
  if (lastDate >= periodEnd) {
    return {
      item: '33',
      direction,
      level: 'ok',
      title: `ไฟล์${label}มีรายการถึงวันสิ้นงวด`,
      detail: `รายการสุดท้ายคือ ${formatDMY(lastDate)}`,
    };
  }
  return {
    item: '33',
    direction,
    level: 'warn',
    title: `ไฟล์${label}มีรายการถึง ${formatDMY(lastDate)} เท่านั้น`,
    detail: `วันสิ้นงวดคือ ${formatDMY(periodEnd)} ให้นำเข้าไฟล์ที่ครอบคลุมถึงวันสิ้นงวด หรือยืนยันในหมายเหตุว่าไม่มีรายการเพิ่มถึงสิ้นงวด`,
  };
}

export function evaluatePeriodChecks(input: PeriodCheckInput): PeriodCheck[] {
  const checks: PeriodCheck[] = [];

  // ── ข้อ 27 กับ 28 ยอดยกมาต้องต่อจากงวดก่อนที่ปิดแล้ว ────────────────────────
  const prev = input.previousClose;
  if (!prev) {
    checks.push({
      item: '27',
      direction: null,
      level: 'unknown',
      title: 'ยังไม่มีงวดก่อนที่ปิดแล้ว จึงเทียบยอดยกมาไม่ได้',
      detail: 'งวดแรกที่เริ่มใช้ระบบ ให้ Master Admin กรอกยอดยกมาพร้อมเลขเอกสารอ้างอิงตามข้อ 31',
    });
  } else {
    const bankOk =
      prev.bankClosing !== null && input.bank.opening !== null && Math.abs(prev.bankClosing - input.bank.opening) < EPS;
    checks.push({
      item: '27',
      direction: null,
      level: input.bank.opening === null || prev.bankClosing === null ? 'unknown' : bankOk ? 'ok' : 'warn',
      title: bankOk
        ? 'ยอดยกมาธนาคารต่อจากงวดก่อนพอดี'
        : 'ยอดยกมาธนาคารไม่เท่ากับยอดสิ้นงวดก่อน',
      detail:
        input.bank.opening === null || prev.bankClosing === null
          ? 'ยังคำนวณยอดยกมาจากไฟล์ไม่ได้ อาจเป็นเพราะธนาคารไม่ส่งยอดคงเหลือมาในไฟล์'
          : `งวดก่อนปิดที่ ${formatDMY(prev.periodEnd)} ยอด ${formatAmount(prev.bankClosing)} บาท งวดนี้ยกมา ${formatAmount(input.bank.opening)} บาท` +
            (bankOk ? '' : ' ต่างกันแปลว่าไฟล์ขาดหรือนำเข้าซ้ำ'),
    });

    const glOk =
      prev.glClosing !== null && input.gl.opening !== null && Math.abs(prev.glClosing - input.gl.opening) < EPS;
    checks.push({
      item: '28',
      direction: null,
      level: input.gl.opening === null ? 'warn' : prev.glClosing === null ? 'unknown' : glOk ? 'ok' : 'warn',
      title:
        input.gl.opening === null
          ? 'ยังไม่ได้กรอกยอดยกมา BC365'
          : glOk
            ? 'ยอดยกมา BC365 ตรงกับที่เก็บไว้ตอนปิดงวดก่อน'
            : 'ยอดยกมา BC365 ไม่เท่ากับยอดที่เก็บไว้ตอนปิดงวดก่อน',
      detail:
        input.gl.opening === null
          ? 'กรอกที่หน้าสรุปยอดคงเหลือ ตามสเปกข้อ 28 ต่อไปจะให้ระบบใส่ให้อัตโนมัติจากงวดก่อน'
          : prev.glClosing === null
            ? 'งวดก่อนไม่ได้เก็บยอด BC365 สิ้นงวดไว้'
            : `งวดก่อนเก็บไว้ ${formatAmount(prev.glClosing)} บาท งวดนี้กรอก ${formatAmount(input.gl.opening)} บาท` +
              (glOk ? '' : ' การพิมพ์ยอดยกมาให้ผลต่างหายไปเป็นสิ่งที่สเปกข้อ 30 ห้าม'),
    });
  }

  // ข้อ 30 ต้องรู้ประเภทของรายการค้างยกมาก่อน จึงจะเทียบกับผลต่างยอดยกมาได้
  checks.push({
    item: '30',
    direction: null,
    level: 'unknown',
    title: 'ยังเทียบผลต่างยอดยกมากับรายการค้างยกมาไม่ได้',
    detail: 'ต้องเก็บประเภทรายการค้างก่อน (สเปกข้อ 16 ต้องมี migration sql/013) ตอนนี้จึงยังไม่มีข้อมูลให้เทียบ',
  });

  // ── ข้อ 32 ถึง 34 ความครบของไฟล์ ──────────────────────────────────────────
  checks.push({
    item: '32',
    direction: null,
    level: input.bank.lineCount === 0 ? 'unknown' : input.bank.chainOk ? 'ok' : 'warn',
    title:
      input.bank.lineCount === 0
        ? 'ยังไม่มีรายการธนาคารในงวดนี้'
        : input.bank.chainOk
          ? 'ยอดคงเหลือในไฟล์ต่อกันครบทุกบรรทัด'
          : 'ยอดคงเหลือในไฟล์ต่อกันไม่ครบ',
    detail:
      input.bank.lineCount === 0
        ? 'นำเข้าไฟล์ของงวดนี้ก่อน'
        : input.bank.chainOk
          ? 'ยอดยกมาที่คำนวณจากไฟล์เชื่อถือได้'
          : 'อาจมีบรรทัดขาดหาย นำเข้าซ้ำ หรือธนาคารไม่ส่งยอดคงเหลือมา ยอดยกมาที่คำนวณได้จึงอาจไม่ถูกต้อง',
  });

  checks.push(coverageCheck('OUT', input.bank.lastDateOut, input.period.to));
  checks.push(coverageCheck('IN', input.bank.lastDateIn, input.period.to));

  const closingOk =
    input.bank.closing !== null &&
    input.bank.statementClosing !== null &&
    Math.abs(input.bank.closing - input.bank.statementClosing) < EPS;
  checks.push({
    item: '34',
    direction: null,
    level:
      input.bank.closing === null || input.bank.statementClosing === null ? 'unknown' : closingOk ? 'ok' : 'warn',
    title: closingOk
      ? 'ยอดคงเหลือที่คำนวณตรงกับบรรทัดสุดท้ายในไฟล์'
      : 'ยอดคงเหลือที่คำนวณไม่ตรงกับบรรทัดสุดท้ายในไฟล์',
    detail:
      input.bank.closing === null || input.bank.statementClosing === null
        ? 'ยังไม่มียอดคงเหลือให้เทียบ'
        : `คำนวณได้ ${formatAmount(input.bank.closing)} บาท ในไฟล์ระบุ ${formatAmount(input.bank.statementClosing)} บาท` +
          (closingOk ? '' : ' ต่างกันแปลว่าไฟล์ยังไม่ครบ'),
  });

  // ── ข้อ 11 กับ 46 ก แยกตามฝั่งที่ต้องยืนยัน ───────────────────────────────
  checks.push(bankUnmatchedCheck('OUT', input.bankUnmatched.OUT));
  checks.push(bankUnmatchedCheck('IN', input.bankUnmatched.IN));

  return checks;
}

/** คำเตือนของฝั่งที่กำลังจะยืนยันงาน รวมข้อที่เป็นของทั้งงวดด้วย */
export function checksForDirection(checks: PeriodCheck[], direction: 'IN' | 'OUT'): PeriodCheck[] {
  return checks.filter((c) => c.direction === null || c.direction === direction);
}

export function warningCount(checks: PeriodCheck[]): number {
  return checks.filter((c) => c.level === 'warn').length;
}
