import { Settings2Icon } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgentStore } from '@/store/agent';
import { agentByIdSelectors } from '@/store/agent/selectors';

import { useAgentId } from '../../hooks/useAgentId';
import Action from '../components/Action';
import Controls from './Controls';

const Params = memo(() => {
  const agentId = useAgentId();
  const [isLoading, isPlatformManaged] = useAgentStore((s) => [
    agentByIdSelectors.isAgentConfigLoadingById(agentId)(s),
    agentByIdSelectors.isAgentPlatformManagedById(agentId)(s),
  ]);
  const [updating, setUpdating] = useState(false);
  const { t } = useTranslation('setting');

  // Model params are admin-owned on a platform-managed agent: the server overlays them on
  // every read and rejects user writes, so the whole control is withheld rather than shown
  // as an editable form that silently reverts.
  if (isPlatformManaged) return null;

  if (isLoading) return <Action disabled icon={Settings2Icon} />;

  return (
    <Action
      icon={Settings2Icon}
      showTooltip={false}
      title={t('settingModel.params.title')}
      popover={{
        content: <Controls setUpdating={setUpdating} updating={updating} />,
        maxWidth: 384,
        minWidth: 384,
        styles: {
          content: {
            borderRadius: 16,
            overflow: 'hidden',
            padding: 0,
          },
        },
      }}
    />
  );
});

export default Params;
