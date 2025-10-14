// src/app/layout.tsx
import "../styles/globals.css";
import Link from "next/link";


export const metadata = { title: "Collab Canvas" };


export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-gray-50 text-gray-900">
        <header className="border-b bg-white">
          <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-semibold">Collab Canvas</Link>
            <div className="space-x-4 text-sm">
              <Link href="/login">Login</Link>
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/canvas">Canvas</Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-10">{children}</main>
      </body>
    </html>
  );
}
