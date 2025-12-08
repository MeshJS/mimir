-- Enable the pgvector extension if not already enabled
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the autodocs_chunks table
CREATE TABLE IF NOT EXISTS autodocs_chunks (
    id BIGSERIAL PRIMARY KEY,
    content TEXT NOT NULL,
    contextual_text TEXT NOT NULL,
    embedding vector(1536),  -- Adjust dimension based on your embedding model
    filepath TEXT NOT NULL,
    chunk_id INTEGER NOT NULL,
    chunk_title TEXT NOT NULL,
    checksum TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    github_url TEXT,
    start_line INTEGER,
    end_line INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint on filepath + chunk_id for upsert
    CONSTRAINT autodocs_chunks_filepath_chunk_id_key UNIQUE (filepath, chunk_id)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_autodocs_chunks_checksum ON autodocs_chunks(checksum);
CREATE INDEX IF NOT EXISTS idx_autodocs_chunks_filepath ON autodocs_chunks(filepath);
CREATE INDEX IF NOT EXISTS idx_autodocs_chunks_entity_type ON autodocs_chunks(entity_type);

-- Create the vector search function
CREATE OR REPLACE FUNCTION match_autodocs(
    query_embedding vector(1536),
    match_count INT DEFAULT 10,
    similarity_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (
    id BIGINT,
    content TEXT,
    contextual_text TEXT,
    embedding vector(1536),
    filepath TEXT,
    chunk_id INTEGER,
    chunk_title TEXT,
    checksum TEXT,
    entity_type TEXT,
    github_url TEXT,
    start_line INTEGER,
    end_line INTEGER,
    similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        ac.id,
        ac.content,
        ac.contextual_text,
        ac.embedding,
        ac.filepath,
        ac.chunk_id,
        ac.chunk_title,
        ac.checksum,
        ac.entity_type,
        ac.github_url,
        ac.start_line,
        ac.end_line,
        1 - (ac.embedding <=> query_embedding) AS similarity
    FROM autodocs_chunks ac
    WHERE 1 - (ac.embedding <=> query_embedding) > similarity_threshold
    ORDER BY ac.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_autodocs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS autodocs_chunks_updated_at ON autodocs_chunks;
CREATE TRIGGER autodocs_chunks_updated_at
    BEFORE UPDATE ON autodocs_chunks
    FOR EACH ROW
    EXECUTE FUNCTION update_autodocs_updated_at();

-- Create HNSW index for faster vector similarity search (optional, for large datasets)
-- Uncomment if needed:
-- CREATE INDEX IF NOT EXISTS idx_autodocs_chunks_embedding ON autodocs_chunks 
--     USING hnsw (embedding vector_cosine_ops);

