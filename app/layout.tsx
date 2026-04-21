import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FiskeLogg - Din digitala fiskeloggbok',
  description: 'Logga dina fångster med AI-analys, väderdata och kartfunktioner',
  manifest: '/manifest.json',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#0B3B5C',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="sv">
      <body className="bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-50 min-h-dvh">
        {children}
      </body>
    </html>
  )
}
