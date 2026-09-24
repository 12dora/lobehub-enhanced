import { Flexbox } from '@lobehub/ui';
import { Alert } from '@lobehub/ui/base-ui';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { checkInterventionSecurityBlacklist } from './securityBlacklist';

interface SecurityBlacklistWarningProps {
  args: Record<string, any>;
}

const SecurityBlacklistWarning = memo<SecurityBlacklistWarningProps>(({ args }) => {
  const { t } = useTranslation('tool');

  const securityCheck = useMemo(() => checkInterventionSecurityBlacklist(args), [args]);

  if (!securityCheck.blocked) return null;

  return (
    <Alert
      colorfulText
      showIcon
      // base-ui greys the description by default; keep the whole warning in the error colour
      styles={{ description: { color: 'inherit' } }}
      title={t('localFiles.securityBlacklist.warning')}
      type="error"
      variant="plain"
      description={
        <Flexbox gap={4} style={{ fontSize: 12 }}>
          <div>{securityCheck.reason ? t(securityCheck.reason as any) : undefined}</div>
        </Flexbox>
      }
    />
  );
});

SecurityBlacklistWarning.displayName = 'SecurityBlacklistWarning';

export default SecurityBlacklistWarning;
