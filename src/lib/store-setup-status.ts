// src/lib/store-setup-status.ts
import type { Store } from '@/types/store';

export type SetupItemKey = 'google_calendar' | 'line_channel';
export type FormType = 'line' | 'web';

export interface SetupItem {
  key: SetupItemKey;
  label: string;
  status: 'complete' | 'incomplete';
  requiredFor: FormType[];
  helpAnchor: string;
}

export interface StoreSetupStatus {
  items: SetupItem[];
  isReadyFor: (formType: FormType) => boolean;
  getMissingFor: (formType: FormType) => SetupItem[];
}

export function getStoreSetupStatus(store: Store): StoreSetupStatus {
  const items: SetupItem[] = [
    {
      key: 'google_calendar',
      label: 'Google Calendar',
      status: store.google_calendar_id ? 'complete' : 'incomplete',
      requiredFor: ['line', 'web'],
      helpAnchor: 'google-calendar',
    },
    {
      key: 'line_channel',
      label: 'LINEチャネル',
      status: store.line_channel_access_token ? 'complete' : 'incomplete',
      requiredFor: ['line'],
      helpAnchor: 'line-setup',
    },
  ];

  const getMissingFor = (formType: FormType): SetupItem[] =>
    items.filter(
      (item) =>
        item.status === 'incomplete' && item.requiredFor.includes(formType)
    );

  const isReadyFor = (formType: FormType): boolean =>
    getMissingFor(formType).length === 0;

  return { items, isReadyFor, getMissingFor };
}
