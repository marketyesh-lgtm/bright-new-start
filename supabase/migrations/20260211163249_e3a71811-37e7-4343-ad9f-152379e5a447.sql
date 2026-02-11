-- Add unique constraint on open_key_id
ALTER TABLE public.shein_auth ADD CONSTRAINT shein_auth_open_key_id_key UNIQUE (open_key_id);

-- Insert the decrypted credentials
INSERT INTO public.shein_auth (open_key_id, secret_key, access_token)
VALUES (
  '724BCA6670944E9EBBC605749C641F3B',
  '6b7a29a11b3123c75fc08d',
  '724BCA6670944E9EBBC605749C641F3B'
)
ON CONFLICT (open_key_id) DO UPDATE SET
  secret_key = EXCLUDED.secret_key,
  access_token = EXCLUDED.access_token,
  updated_at = now();