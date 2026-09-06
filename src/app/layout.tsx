import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sirenix',
  description: 'Scalping analysis for GOLD and BRENT OIL from live Capital.com market data.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
