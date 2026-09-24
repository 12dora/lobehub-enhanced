'use client';

import { DingtalkPersonalSettingsStrip } from '@/features/DingtalkPersonal';
import { ManagedConnectorSettings } from '@/features/PlatformConnectorAuthorization';
import { ToolSettings } from '@/routes/(main)/settings/skill';

const Page = () => (
  <DingtalkPersonalSettingsStrip>
    <ManagedConnectorSettings fallback={<ToolSettings managed={false} viewMode="connector" />} />
  </DingtalkPersonalSettingsStrip>
);

Page.displayName = 'ConnectorSettings';

export default Page;
