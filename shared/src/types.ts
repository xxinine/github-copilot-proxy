export interface User {
  id: number;
  username: string;
  password_hash: string;
  is_admin: number;
  status: 'active' | 'disabled';
  created_at: string;
}

export interface ApiKey {
  id: number;
  user_id: number;
  key_hash: string;
  key_prefix: string;
  name: string;
  status: 'active' | 'revoked';
  created_at: string;
}

export interface Account {
  id: number;
  user_id: number;
  gh_token_enc: string;
  gh_login: string | null;
  container_name: string | null;
  status: 'pending' | 'running' | 'stopped' | 'error';
  last_error: string | null;
  created_at: string;
}

export interface UsageLog {
  id: number;
  user_id: number;
  account_id: number;
  path: string;
  model: string | null;
  status_code: number | null;
  created_at: string;
}
