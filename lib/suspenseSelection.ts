// Counts must refer to the active IN/OUT tab, like the other reconcile actions.
export function suspenseSelectionProblem(bankCount: number, glCount: number): string | null {
  if (bankCount > 0) {
    return 'พักรายการได้เฉพาะฝั่ง BC365 กรุณายกเลิกการเลือกฝั่งธนาคารก่อน หากต้องการจับคู่ทั้งสองฝั่ง ให้ใช้ปุ่มจับคู่';
  }
  if (glCount === 0) {
    return 'กรุณาเลือกรายการ BC365 ที่ต้องการพักอย่างน้อย 1 รายการ';
  }
  return null;
}
