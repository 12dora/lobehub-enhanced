'use client';

import { DingtalkPersonalSettingsStrip } from '@/features/DingtalkPersonal';
import { ManagedConnectorSettings } from '@/features/PlatformConnectorAuthorization';
import { ToolSettings } from '@/routes/(main)/settings/skill';

const WorkspaceConnectorSetting = () => (
  <DingtalkPersonalSettingsStrip>
    <ManagedConnectorSettings fallback={<ToolSettings viewMode="connector" />} />
  </DingtalkPersonalSettingsStrip>
);

WorkspaceConnectorSetting.displayName = 'WorkspaceConnectorSetting';

export default WorkspaceConnectorSetting;
