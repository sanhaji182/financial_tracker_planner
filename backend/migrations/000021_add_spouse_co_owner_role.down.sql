UPDATE users SET role = 'spouse_viewer' WHERE role = 'spouse_co_owner';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'spouse_viewer'));
