'use client';

import { Button } from '@lobehub/ui';
import { ModalFooter, useModalContext } from '@lobehub/ui/base-ui';
import { type FormInstance } from 'antd';
import isEqual from 'fast-deep-equal';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { aiModelSelectors, useScopedAiInfraStore as useAiInfraStore } from '@/store/aiInfra';

import { mergeModelConfigValues } from './mergeModelConfigValues';

interface ModelConfigFooterProps {
  formRef: { current?: FormInstance };
  id: string;
}

const ModelConfigFooter = memo<ModelConfigFooterProps>(({ formRef, id }) => {
  const { t } = useTranslation('common');
  const { close } = useModalContext();
  const [loading, setLoading] = useState(false);
  const [editingProvider, updateAiModelsConfig] = useAiInfraStore((s) => [
    s.activeAiProvider!,
    s.updateAiModelsConfig,
  ]);
  // The row the form was opened with: keys the form does not render are carried over from it.
  const model = useAiInfraStore(aiModelSelectors.getAiModelById(id), isEqual);

  return (
    <ModalFooter>
      <Button onClick={close}>{t('cancel')}</Button>
      <Button
        loading={loading}
        type="primary"
        onClick={async () => {
          const form = formRef.current;
          if (!editingProvider || !id || !form) return;
          const data = mergeModelConfigValues(model, form.getFieldsValue());

          setLoading(true);
          try {
            await updateAiModelsConfig(id, editingProvider, data);
          } finally {
            // Always clear: a rejected write must not leave the OK button spinning.
            setLoading(false);
          }

          close();
        }}
      >
        {t('ok')}
      </Button>
    </ModalFooter>
  );
});

export default ModelConfigFooter;
