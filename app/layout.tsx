import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Image → 4-Color 3D Print",
  description:
    "Convert any image into a flat, 5 mm thick, 4-color 3D-printable plate (3MF / STL) — entirely in your browser.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
