import { redirect } from 'next/navigation';
import { AppShell } from '@/components/AppShell';
import { MarketDataProvider } from '@/components/MarketData';
import { currentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * The signed-in half of the app.
 *
 * Everything inside this group is behind the check below, and the API routes
 * carry the same check of their own: a page that renders is not what makes data
 * safe, the route that serves it is.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');

  return (
    <MarketDataProvider>
      <AppShell user={user}>{children}</AppShell>
    </MarketDataProvider>
  );
}
