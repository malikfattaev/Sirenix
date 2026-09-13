import { recentSkips, skipSummary } from '@/lib/db/skips';

console.log('Rejected minute snapshots over the last 24 hours (not unique trading opportunities):');
console.table(skipSummary(Date.now() - 86_400_000));
console.log(JSON.stringify(recentSkips(10), null, 2));
