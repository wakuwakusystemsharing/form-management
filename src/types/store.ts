import type { Form } from './form';

export interface Store {
  id: string;                 // UUID (staging/production) or st形式 (local)
  name: string;
  description?: string;
  owner_name: string;
  owner_email: string;
  phone?: string;
  address?: string;
  website_url?: string;
  created_at: string;
  updated_at: string;
  status: 'active' | 'inactive';
}

export interface StoreWithForms extends Store {
  forms: Form[];
  total_forms: number;
  active_forms: number;
}
