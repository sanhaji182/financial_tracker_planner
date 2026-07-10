CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL,
    file_type VARCHAR(50),
    file_size INTEGER,
    linked_entity_type VARCHAR(50),      -- transaction, asset, debt, bill
    linked_entity_id UUID,
    tags TEXT[],
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_documents_user ON documents(user_id);
CREATE INDEX idx_documents_entity ON documents(linked_entity_type, linked_entity_id);
