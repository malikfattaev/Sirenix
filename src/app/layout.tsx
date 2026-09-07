import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sirenix',
  description: 'Торговые сигналы по золоту, нефти, индексам и валютам на данных Capital.com.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
