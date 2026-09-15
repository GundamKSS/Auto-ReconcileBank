import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AuthGuard from '../components/AuthGuard';
import { SidebarProvider } from '../components/SidebarContext';
import AppShell from '../components/AppShell';
import PressFeedback from '../components/PressFeedback';


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // หน้าลูกตั้งแค่ชื่อหน้า เช่น "Dashboard" → แท็บจะแสดง "Dashboard · Auto Reconcile Bank"
  title: {
    template: "%s · Auto Reconcile Bank",
    default: "Auto Reconcile Bank",
  },
  description: "ระบบกระทบยอดธนาคารอัตโนมัติ (Bank Reconciliation)",
  applicationName: "Auto Reconcile Bank",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
   return (
    <html lang="th">
      <body>
        <PressFeedback />
        <AuthGuard>
          <SidebarProvider>
            <AppShell>{children}</AppShell>
          </SidebarProvider>
        </AuthGuard>
      </body>
    </html>
  );
}
