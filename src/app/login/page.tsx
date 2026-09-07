import { LoginForm } from '@/components/LoginForm';
import { noAccountsYet } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <LoginForm empty={noAccountsYet()} />;
}
