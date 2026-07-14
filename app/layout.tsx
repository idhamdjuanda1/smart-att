import type { Metadata, Viewport } from "next";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#07363b",
};

export const metadata: Metadata = {
  title: {
    default: "SMART-ATT — Absensi QR & Smart Quiz",
    template: "%s · SMART-ATT",
  },
  description: "Platform sekolah untuk absensi QR, data siswa, tugas, ujian online, dan komunikasi wali murid.",
  applicationName: "SMART-ATT",
  keywords: ["absensi sekolah", "QR siswa", "ujian online", "smart quiz", "SMART-ATT"],
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
