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
  api_key_id: number | null;
  path: string;
  endpoint_kind: string | null;
  model: string | null;
  status_code: number | null;
  stream: number;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cached_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  cost_nano_aiu: number | null;
  duration_ms: number | null;
  ttfb_ms: number | null;
  error_type: string | null;
  created_at: string;
}
