import { serveStatusSummary } from '@/server/enterprise/services/platformSystem/statusApi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = serveStatusSummary;
