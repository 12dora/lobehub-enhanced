import { serveStatusHealth } from '@/server/enterprise/services/platformSystem/statusApi';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export const GET = serveStatusHealth;
