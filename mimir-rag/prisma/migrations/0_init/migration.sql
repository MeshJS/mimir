create extension if not exists vector;

create table if not exists docs (
    id bigserial primary key,
    content text not null,
    contextual_text text not null,
    embedding vector(3072) not null,
    filepath text not null,
    chunk_id integer not null,
    chunk_title text not null,
    checksum text not null,
    github_url text,
    docs_url text,
    final_url text,
    source_type text not null default 'mdx',
    entity_type text,
    start_line integer,
    end_line integer,
    search_tokens tsvector generated always as (
        setweight(to_tsvector('english', coalesce(chunk_title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(contextual_text, '')), 'C')
    ) stored,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint docs_filepath_chunk_id_unique unique (filepath, chunk_id)
);

-- AlterTable (for existing tables)
alter table docs
    add column if not exists source_type text not null default 'mdx',
    add column if not exists entity_type text,
    add column if not exists start_line integer,
    add column if not exists end_line integer,
    add column if not exists search_tokens tsvector generated always as (
        setweight(to_tsvector('english', coalesce(chunk_title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(content, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(contextual_text, '')), 'C')
    ) stored;

-- CreateIndex
create index if not exists docs_filepath_idx on docs (filepath);
create index if not exists docs_checksum_idx on docs (checksum);
create index if not exists docs_search_tokens_idx on docs using gin (search_tokens);
create index if not exists docs_source_type_idx on docs (source_type);
create index if not exists docs_entity_type_idx on docs (entity_type);

-- CreateFunction
create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

-- DropTrigger
drop trigger if exists trg_docs_updated_at on docs;

-- CreateTrigger
create trigger trg_docs_updated_at
before update on docs
for each row
execute procedure set_updated_at();

-- DropFunction (if exists)
drop function if exists match_docs(vector(3072), integer, float);
drop function if exists match_docs_bm25(text, integer);

-- CreateFunction match_docs
create or replace function match_docs (
    query_embedding vector(3072),
    match_count integer default 10,
    similarity_threshold float default 0.75
)
returns table (
    id bigint,
    content text,
    contextual_text text,
    embedding vector(3072),
    filepath text,
    chunk_id integer,
    chunk_title text,
    checksum text,
    github_url text,
    docs_url text,
    final_url text,
    source_type text,
    entity_type text,
    start_line integer,
    end_line integer,
    similarity float
) language sql as $$
  select
    id,
    content,
    contextual_text,
    embedding,
    filepath,
    chunk_id,
    chunk_title,
    checksum,
    github_url,
    docs_url,
    final_url,
    source_type,
    entity_type,
    start_line,
    end_line,
    1 - (embedding <=> query_embedding) as similarity
  from docs
  where 1 - (embedding <=> query_embedding) >= similarity_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- CreateFunction match_docs_bm25
create or replace function match_docs_bm25 (
    query text,
    match_count integer default 10
)
returns table (
    id bigint,
    content text,
    contextual_text text,
    embedding vector(3072),
    filepath text,
    chunk_id integer,
    chunk_title text,
    checksum text,
    github_url text,
    docs_url text,
    final_url text,
    source_type text,
    entity_type text,
    start_line integer,
    end_line integer,
    bm25_rank float
) language sql as $$
  with search_query as (
      select websearch_to_tsquery('english', query) as ts_query
  )
  select
      d.id,
      d.content,
      d.contextual_text,
      d.embedding,
      d.filepath,
      d.chunk_id,
      d.chunk_title,
      d.checksum,
      d.github_url,
      d.docs_url,
      d.final_url,
      d.source_type,
      d.entity_type,
      d.start_line,
      d.end_line,
      ts_rank_cd(d.search_tokens, sq.ts_query) as bm25_rank
  from docs d
  cross join search_query sq
  where sq.ts_query @@ d.search_tokens
  order by bm25_rank desc
  limit match_count;
$$;
