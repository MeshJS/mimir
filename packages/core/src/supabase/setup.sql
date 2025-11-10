create extension if not exists vector;

create table if not exists docs (
    id bigserial primary key,
    content text not null,
    contextual_text text not null,
    embedding vector(1536) not null,
    filepath text not null,
    chunk_id integer not null,
    chunk_title text not null,
    checksum text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint docs_filepath_chunk_id_unique unique (filepath, chunk_id)
);

create index if not exists docs_filepath_idx on docs (filepath);
create index if not exists docs_checksum_idx on docs (checksum);

create or replace function set_updated_at()
returns trigger as $$
begin
    new.updated_at = now();
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_docs_updated_at on docs;
create trigger trg_docs_updated_at
before update on docs
for each row
execute procedure set_updated_at();

create or replace function match_docs (
    query_embedding vector(1536),
    match_count integer default 10,
    similarity_threshold float default 0.75
)
returns table (
    id bigint,
    context text,
    contextual_text text,
    embedding vector(1536),
    filepath text,
    chunk_id integer,
    chunk_title text,
    checksum text,
    similarity float
) language sql table as $$
  select
    id,
    content,
    contextual_text,
    embedding,
    filepath,
    chunk_id,
    chunk_title,
    checksum,
    1 - (embedding <=> query_embedding) as similarity
  from docs
  where 1 - (embedding <=> query_embedding) >= similarity_threshold
  order by embedding <=> query_embedding
  limit match_count;
$$;

