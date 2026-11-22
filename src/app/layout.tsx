import type { Metadata, Viewport } from "next";
import { Playfair_Display, Manrope } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

// v44.1: зум страницы запрещён (maximum-scale=1) — иначе iOS перехватывает
// пинч двумя пальцами под собственный «зум страницы», и лупа деталей не
// получает жест. Увеличение фото делает наша лупа (ZoomViewer).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "GlamAI Studio — ИИ-примерка макияжа",
  description:
    "Виртуальный ИИ-визажист для студии макияжа: загрузите фото модели и посмотрите, как на ней ляжет макияж, либо перенесите образ с референса. Палитра оттенков, кисти и инструменты визажиста.",
  keywords: ["макияж", "визаж", "ИИ", "примерка", "бьюти", "студия макияжа", "GlamAI"],
  icons: {
    icon: "/glamai.svg",
  },
  openGraph: {
    title: "GlamAI Studio — ИИ-примерка макияжа",
    description: "Примерка макияжа на фото и перенос образа с референса с помощью ИИ.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body
        className={`${playfair.variable} ${manrope.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
