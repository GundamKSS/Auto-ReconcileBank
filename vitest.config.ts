import { defineConfig } from 'vitest/config';

// เทสชุดนี้เป็น unit test ของตรรกะล้วนใน lib/ เท่านั้น — ไม่ต่อฐานข้อมูลจริง
// (ต่อ DB จริงแล้วเผลอเขียนทับข้อมูลกระทบยอดของทีมบัญชีได้ และผลเทสจะเปลี่ยนไปตามข้อมูลในงวด)
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // .next มีไฟล์ที่ build ไว้แล้วซ้ำกับต้นฉบับ ถ้าไม่กันไว้ vitest จะเก็บไปรันด้วย
    exclude: ['node_modules/**', '.next/**', 'docs/**'],
    // vitest ไม่อ่าน .env ให้ — ตั้งคีย์ปลอมไว้ตรงนี้เพื่อให้ lib/session.ts เซ็น token ด้วยคีย์คงที่
    // ห้ามใช้คีย์จริงของเครื่อง deploy เด็ดขาด
    env: { SESSION_SECRET: 'test-secret-do-not-use-in-production' },
  },
});
