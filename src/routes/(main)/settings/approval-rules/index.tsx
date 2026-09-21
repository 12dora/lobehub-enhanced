import { useTranslation } from 'react-i18next';

import DingTalkApprovalRules from '@/features/DingTalkApprovalRules';
import SettingHeader from '@/routes/(main)/settings/features/SettingHeader';

const Page = () => {
  const { t } = useTranslation('setting');
  return (
    <>
      <SettingHeader title={t('tab.approvalRules')} />
      <DingTalkApprovalRules />
    </>
  );
};

export default Page;
