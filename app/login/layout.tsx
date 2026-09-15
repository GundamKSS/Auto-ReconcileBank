import type { Metadata } from 'next';

// หน้า login เป็น Client Component ประกาศ metadata เองไม่ได้ จึงตั้งชื่อแท็บไว้ที่ layout นี้
export const metadata: Metadata = {
  title: 'เข้าสู่ระบบ',
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
