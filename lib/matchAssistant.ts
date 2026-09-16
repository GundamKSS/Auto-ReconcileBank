// ผู้ช่วยหาคู่ (Match Assistant) — หาคู่ Bank ↔ GL ที่ "ยอดตรงกันพอดี แต่ลงวันที่ไม่ตรงกัน"
// เช่น Bank 20/08 ยอด 500.69 กับ GL 25/08 ยอด 500.69 ซึ่งการติ๊กอัตโนมัติในตาราง (จับเฉพาะวันเดียวกัน) หาไม่เจอ
//
// ไฟล์นี้เป็นฟังก์ชันล้วน ไม่แตะ DB — /api/reconcile/assistant เป็นคนดึงข้อมูลมาส่งให้
// และไม่บันทึกอะไรทั้งสิ้น ผู้ใช้ต้องตรวจแล้วกด Match เองทุกคู่ (requirements ข้อ 27)
// ใช้กติกาล้วนๆ (ไม่ได้ส่งข้อมูลไปให้ AI ภายนอก) ผลลัพธ์จึงเหมือนเดิมทุกครั้งและอธิบายเหตุผลได้

export type Direction = 'IN' | 'OUT';

export type AssistantBankLine = {
  lineId: number;
  date: string; // 'YYYY-MM-DD'
  direction: Direction;
  amount: number;
  description: string;
  ref: string;
  channel: string | null;
};

export type AssistantGlLine = {
  entryNo: number;
  date: string; // 'YYYY-MM-DD'
  direction: Direction;
  amount: number;
  documentNo: string;
  accountNo: string;
  accountName: string | null;
};

export type AssistantReason = { tone: 'good' | 'warn' | 'info'; text: string };

export type AssistantCandidate = {
  gl: AssistantGlLine;
  outsidePeriod: boolean;
  score: number; // 5-100
  dayGap: number; // วันที่ GL ลบวันที่ Bank (ติดลบ = GL ลงก่อน)
  businessDays: number; // ระยะห่างนับเฉพาะ จ.-ศ. (อย่างน้อย 1)
  reasons: AssistantReason[];
};

export type AssistantSuggestion = {
  bank: AssistantBankLine;
  candidates: AssistantCandidate[]; // ตัวที่แนะนำ (suggestedEntryNo) อยู่ก่อน ที่เหลือเรียงคะแนนมาก → น้อย
  // GL ที่แนะนำให้เลือกไว้ก่อน — ไล่จากการ์ดคะแนนสูงสุด GL ตัวเดียวจะไม่ถูกแนะนำซ้ำ 2 การ์ด
  // null = GL ทุกตัวของการ์ดนี้ถูกแนะนำให้การ์ดที่คะแนนสูงกว่าไปแล้ว (ยังเลือกเองได้)
  suggestedEntryNo: number | null;
};

export type AssistantResult = {
  windowDays: number;
  suggestions: AssistantSuggestion[];
  scannedBank: number; // Bank ในงวดที่ยังไม่จับคู่
  explainedSameDay: number; // ในนั้นมีกี่รายการที่จับกลุ่มวันเดียวกันได้อยู่แล้ว (ตารางติ๊กให้อยู่แล้ว)
};

export const ASSISTANT_WINDOW_OPTIONS = [3, 7, 15, 30] as const;
export const DEFAULT_ASSISTANT_WINDOW = 7;
export const MAX_ASSISTANT_WINDOW = 31;

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 75) return 'high';
  if (score >= 50) return 'medium';
  return 'low';
}

// ผลต่างที่ยอมรับได้ — ต้องตรงกับ AMOUNT_TOLERANCE ใน api/reconcile/match ไม่งั้นแนะนำคู่ที่กด Match ไม่ผ่าน
const AMOUNT_TOLERANCE = 0.005;
const DAY_MS = 86_400_000;

type Item = { id: number; amount: number };
type RawCluster = { bankIds: number[]; glIds: number[] };

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

// ── จับกลุ่มวันเดียวกัน ──────────────────────────────────────────────────────────
// ต้องทำงานเหมือน findSubsetSumClient/computeReadyIds ใน ActiveWorkspace ทุกประการ — ใช้กันรายการที่หน้าจอติ๊ก/จัด "กลุ่ม N" ให้อยู่แล้วออก
// ผู้ช่วยจะได้ไม่เสนอคู่ข้ามวันที่ขัดกับกลุ่มที่ผู้ใช้เห็นอยู่บนตาราง
function findSubsetSum(items: Item[], target: number, maxSize = 5): Item[] | null {
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  const reach = [0];
  for (const item of sorted) reach.push(reach[reach.length - 1] + Math.max(item.amount, 0));
  const chosen: Item[] = [];
  function backtrack(startIdx: number, remaining: number): boolean {
    if (Math.abs(remaining) < 0.005 && chosen.length > 0) return true;
    const slots = maxSize - chosen.length;
    if (slots <= 0) return false;
    for (let i = startIdx; i < sorted.length; i++) {
      if (sorted[i].amount - remaining > 0.005) continue;
      if (reach[Math.min(i + slots, sorted.length)] - reach[i] < remaining - 0.005) break;
      if (i > startIdx && sorted[i].amount === sorted[i - 1].amount) continue;
      chosen.push(sorted[i]);
      if (backtrack(i + 1, remaining - sorted[i].amount)) return true;
      chosen.pop();
    }
    return false;
  }
  return backtrack(0, target) ? [...chosen] : null;
}

function clusterSameDay(bankItems: Item[], glItems: Item[]): RawCluster[] {
  const remainingBank = [...bankItems];
  const remainingGl = [...glItems];
  const clusters: RawCluster[] = [];

  for (let i = remainingBank.length - 1; i >= 0; i--) {
    const b = remainingBank[i];
    const j = remainingGl.findIndex((g) => Math.abs(g.amount - b.amount) < 0.005);
    if (j !== -1) {
      clusters.push({ bankIds: [b.id], glIds: [remainingGl[j].id] });
      remainingBank.splice(i, 1);
      remainingGl.splice(j, 1);
    }
  }
  for (let i = remainingBank.length - 1; i >= 0; i--) {
    const b = remainingBank[i];
    const subset = findSubsetSum(remainingGl, b.amount);
    if (subset) {
      clusters.push({ bankIds: [b.id], glIds: subset.map((s) => s.id) });
      remainingBank.splice(i, 1);
      for (const s of subset) {
        const idx = remainingGl.findIndex((g) => g.id === s.id);
        if (idx !== -1) remainingGl.splice(idx, 1);
      }
    }
  }
  for (let i = remainingGl.length - 1; i >= 0; i--) {
    const g = remainingGl[i];
    const subset = findSubsetSum(remainingBank, g.amount);
    if (subset) {
      clusters.push({ bankIds: subset.map((s) => s.id), glIds: [g.id] });
      remainingGl.splice(i, 1);
      for (const s of subset) {
        const idx = remainingBank.findIndex((b) => b.id === s.id);
        if (idx !== -1) remainingBank.splice(idx, 1);
      }
    }
  }
  return clusters;
}

// ── ให้คะแนน ─────────────────────────────────────────────────────────────────────
function dayNumber(iso: string) {
  return Math.round(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);
}

// นับวันทำการ (จ.-ศ.) ระหว่างสองวัน ไม่นับวันเริ่ม นับวันจบ — ไม่รู้วันหยุดนักขัตฤกษ์ รู้แค่เสาร์-อาทิตย์
// ศุกร์ → จันทร์ ห่าง 3 วันตามปฏิทิน แต่นับเป็น 1 วันทำการ ซึ่งใกล้กับความเป็นจริงของการลงบัญชีมากกว่า
function businessDaysBetween(a: number, b: number) {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  let n = 0;
  for (let d = lo + 1; d <= hi; d++) {
    const weekday = new Date(d * DAY_MS).getUTCDay();
    if (weekday !== 0 && weekday !== 6) n++;
  }
  return Math.max(1, n);
}

function scoreCandidate(args: {
  bank: AssistantBankLine;
  gl: AssistantGlLine;
  dayGap: number;
  glOptions: number; // GL ยอดเท่ากันกี่ตัวที่ Bank รายการนี้เลือกได้
  otherBanks: number; // Bank รายการอื่นที่เข้าคู่กับ GL ตัวนี้ได้เหมือนกัน
  windowDays: number;
  glInPeriod: boolean;
}): AssistantCandidate {
  const { bank, gl, dayGap, glOptions, otherBanks, windowDays, glInPeriod } = args;
  const reasons: AssistantReason[] = [{ tone: 'good', text: 'ยอดเงินตรงกันพอดี' }];
  let score = 100;

  const businessDays = businessDaysBetween(dayNumber(bank.date), dayNumber(gl.date));
  score -= Math.min(45, businessDays * 5);
  const absGap = Math.abs(dayGap);
  const when = dayGap > 0 ? `GL ลงหลัง Bank ${absGap} วัน` : `GL ลงก่อน Bank ${absGap} วัน`;
  reasons.push({
    tone: businessDays <= 2 ? 'good' : businessDays <= 5 ? 'info' : 'warn',
    text: businessDays < absGap ? `${when} (${businessDays} วันทำการ)` : when,
  });

  // ยิ่งมียอดเท่ากันให้เลือกหลายตัว ยิ่งเสี่ยงจับผิดคู่ (เคสจริง: ค่าธรรมเนียม 10 บาทหลายรายการ)
  const extra = glOptions - 1 + otherBanks;
  // หักหนัก: Bank 2 รายการแย่ง GL ตัวเดียว = โอกาสถูกแค่ครึ่งเดียว ไม่ควรขึ้นเป็น "ปานกลาง"
  score -= Math.min(50, extra * 25);
  if (extra === 0) reasons.push({ tone: 'good', text: `ยอดนี้มีคู่เดียวในช่วง ±${windowDays} วัน` });
  if (glOptions > 1) reasons.push({ tone: 'warn', text: `มี GL ยอดเท่ากันให้เลือก ${glOptions} รายการ` });
  if (otherBanks > 0) reasons.push({ tone: 'warn', text: `GL นี้เข้าคู่กับ Bank รายการอื่นได้อีก ${otherBanks} รายการ` });

  // ยอดมีเศษสตางค์บังเอิญซ้ำกันยาก / ยอดเล็กที่เป็นเลขกลมมักเป็นค่าธรรมเนียมที่เกิดซ้ำทุกวัน
  if (Math.round(bank.amount * 100) % 100 !== 0) {
    reasons.push({ tone: 'good', text: 'ยอดมีเศษสตางค์ บังเอิญซ้ำกันยาก' });
  } else {
    score -= 5;
    if (bank.amount < 100) {
      score -= 15;
      reasons.push({ tone: 'warn', text: 'ยอดเล็กเลขกลม มักเป็นค่าธรรมเนียมที่ซ้ำบ่อย' });
    }
  }

  if (!glInPeriod) reasons.push({ tone: 'info', text: 'GL ลงวันที่นอกงวดที่เลือก' });

  return {
    gl,
    outsidePeriod: !glInPeriod,
    score: Math.max(5, Math.round(score)),
    dayGap,
    businessDays,
    reasons,
  };
}

/**
 * bankLines / glLines = รายการที่ยังไม่จับคู่ ช่วง [งวดเริ่ม - windowDays, งวดสิ้นสุด + windowDays]
 * ต้องเรียงแบบเดียวกับ /api/reconcile/data (วันที่ใหม่ → เก่า, id มาก → น้อย) เพื่อให้การจับกลุ่มวันเดียวกัน
 * ได้ผลตรงกับที่หน้าจอคำนวณไว้
 *
 * Bank นอกงวดไม่ถูกเสนอเป็นการ์ด แต่ยังนับเป็น "คู่แข่ง" ของ GL — กันเคส GL ต้นเดือนที่จริงๆ
 * เป็นคู่ของ Bank เดือนก่อน ถูกเสนอให้ Bank เดือนนี้ด้วยคะแนนสูงเกินจริง
 */
export function findNearDateMatches(input: {
  bankLines: AssistantBankLine[];
  glLines: AssistantGlLine[];
  periodFrom: string;
  periodTo: string;
  windowDays: number;
}): AssistantResult {
  const { bankLines, glLines, periodFrom, periodTo, windowDays } = input;
  const inPeriod = (date: string) => date >= periodFrom && date <= periodTo;

  // 1) กันรายการที่จับกลุ่มวันเดียวกันได้อยู่แล้วออก
  const bankByKey = new Map<string, Item[]>();
  for (const b of bankLines) push(bankByKey, `${b.date}_${b.direction}`, { id: b.lineId, amount: b.amount });
  const glByKey = new Map<string, Item[]>();
  for (const g of glLines) push(glByKey, `${g.date}_${g.direction}`, { id: g.entryNo, amount: g.amount });

  const reservedBank = new Set<number>();
  const reservedGl = new Set<number>();
  for (const [key, bankItems] of bankByKey) {
    const glItems = glByKey.get(key);
    if (!glItems || glItems.length === 0) continue;
    for (const c of clusterSameDay(bankItems, glItems)) {
      c.bankIds.forEach((id) => reservedBank.add(id));
      c.glIds.forEach((id) => reservedGl.add(id));
    }
  }

  // 2) จับคู่ยอดเท่ากันพอดี ทิศทางเดียวกัน คนละวัน ห่างไม่เกิน windowDays
  const glByAmount = new Map<string, AssistantGlLine[]>();
  for (const g of glLines) {
    const cents = Math.round(g.amount * 100);
    if (reservedGl.has(g.entryNo) || cents <= 0) continue;
    push(glByAmount, `${g.direction}_${cents}`, g);
  }

  type Edge = { gl: AssistantGlLine; dayGap: number };
  const edgesByBank = new Map<number, { bank: AssistantBankLine; edges: Edge[] }>();
  const banksPerGl = new Map<number, number>();
  for (const b of bankLines) {
    const cents = Math.round(b.amount * 100);
    if (reservedBank.has(b.lineId) || cents <= 0) continue;
    const bankDay = dayNumber(b.date);
    for (const g of glByAmount.get(`${b.direction}_${cents}`) ?? []) {
      if (Math.abs(g.amount - b.amount) >= AMOUNT_TOLERANCE) continue;
      const dayGap = dayNumber(g.date) - bankDay;
      // วันเดียวกันเป็นงานของการติ๊กอัตโนมัติในตารางอยู่แล้ว
      if (dayGap === 0 || Math.abs(dayGap) > windowDays) continue;
      const entry = edgesByBank.get(b.lineId) ?? { bank: b, edges: [] };
      entry.edges.push({ gl: g, dayGap });
      edgesByBank.set(b.lineId, entry);
      banksPerGl.set(g.entryNo, (banksPerGl.get(g.entryNo) ?? 0) + 1);
    }
  }

  // 3) ให้คะแนนเฉพาะ Bank ในงวด
  const suggestions: AssistantSuggestion[] = [];
  for (const { bank, edges } of edgesByBank.values()) {
    if (!inPeriod(bank.date)) continue;
    const candidates = edges.map((e) =>
      scoreCandidate({
        bank,
        gl: e.gl,
        dayGap: e.dayGap,
        glOptions: edges.length,
        otherBanks: (banksPerGl.get(e.gl.entryNo) ?? 1) - 1,
        windowDays,
        glInPeriod: inPeriod(e.gl.date),
      })
    );
    candidates.sort(
      (a, b) => b.score - a.score || Math.abs(a.dayGap) - Math.abs(b.dayGap) || a.gl.entryNo - b.gl.entryNo
    );
    suggestions.push({ bank, candidates, suggestedEntryNo: null });
  }

  const byTopScore = (a: AssistantSuggestion, b: AssistantSuggestion) =>
    b.candidates[0].score - a.candidates[0].score ||
    a.bank.date.localeCompare(b.bank.date) ||
    a.bank.lineId - b.bank.lineId;
  suggestions.sort(byTopScore);

  const taken = new Set<number>();
  for (const s of suggestions) {
    const pick = s.candidates.find((c) => !taken.has(c.gl.entryNo));
    if (!pick) continue;
    s.suggestedEntryNo = pick.gl.entryNo;
    taken.add(pick.gl.entryNo);
    // ตัวที่แนะนำขึ้นก่อนเสมอ — คะแนนบนการ์ด แถบสรุปสูง/กลาง/ต่ำ และลำดับการ์ดจะได้อิงตัวเดียวกัน
    s.candidates = [pick, ...s.candidates.filter((c) => c !== pick)];
  }
  suggestions.sort(byTopScore);

  const periodBank = bankLines.filter((b) => inPeriod(b.date));
  return {
    windowDays,
    suggestions,
    scannedBank: periodBank.length,
    explainedSameDay: periodBank.filter((b) => reservedBank.has(b.lineId)).length,
  };
}
