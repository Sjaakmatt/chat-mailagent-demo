import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Werkbak — FactumAI",
  description: "Werkbak voor de AIOS mail-agent (ReviewItems)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fonts (Fraunces/DM Sans) worden via @import in globals.css geladen.
  return (
    <html lang="nl">
      <body>{children}</body>
    </html>
  );
}
