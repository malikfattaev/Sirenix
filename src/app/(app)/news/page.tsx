import { ModuleHeader } from '@/components/AppShell';
import { NewsBoard } from '@/components/NewsBoard';

export default function NewsPage() {
  return (
    <>
      <ModuleHeader
        title="НОВОСТИ"
        hint="Заголовки с открытых лент, взвешенные по свежести и по тому, насколько рынок в них главный. Оценка от -1 за падение до +1 за рост."
      />
      <NewsBoard />
    </>
  );
}
