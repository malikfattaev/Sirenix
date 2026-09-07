import { notFound } from 'next/navigation';
import { ModuleHeader } from '@/components/AppShell';
import { AccessPanel } from '@/components/AccessPanel';
import { currentUser } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * Not for everyone, and not merely hidden: someone who types the address
 * without the role gets the same answer as for a page that does not exist,
 * which tells them nothing about what is here.
 */
export default async function AccessPage() {
  const user = await currentUser();
  if (user?.role !== 'admin') notFound();

  return (
    <>
      <ModuleHeader title="ДОСТУП" hint="Кто может войти и что ему видно." />
      <AccessPanel currentUserId={user.id} />
    </>
  );
}
