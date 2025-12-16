-- Script to fix duplicate chunks with same (filepath, chunk_id) but different source_type
-- Run this in Supabase SQL Editor to clean up any existing conflicts

-- Step 1: Identify duplicate chunks (same filepath + chunk_id, different IDs)
-- This query shows chunks that share the same (filepath, chunk_id) combination
SELECT 
    filepath,
    chunk_id,
    COUNT(*) as duplicate_count,
    array_agg(id ORDER BY id) as chunk_ids,
    array_agg(source_type ORDER BY id) as source_types,
    array_agg(checksum ORDER BY id) as checksums
FROM docs
GROUP BY filepath, chunk_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC, filepath, chunk_id;

-- Step 2: For each duplicate group, keep the chunk with the most recent updated_at
-- and mark others for deletion (or move them to a temporary location)
-- This query generates UPDATE statements to move duplicates to temp locations
WITH duplicates AS (
    SELECT 
        id,
        filepath,
        chunk_id,
        source_type,
        updated_at,
        ROW_NUMBER() OVER (
            PARTITION BY filepath, chunk_id 
            ORDER BY updated_at DESC, id DESC
        ) as rn
    FROM docs
)
SELECT 
    'UPDATE docs SET filepath = ''__duplicate_' || id || ''', chunk_id = -' || id || ' WHERE id = ' || id || ';' as update_sql
FROM duplicates
WHERE rn > 1;

-- Step 3: Normalize source_type values (legacy -> normalized)
-- Convert 'typescript' and 'python' to 'code', 'mdx' to 'doc'
UPDATE docs
SET source_type = CASE
    WHEN source_type IN ('typescript', 'python') THEN 'code'
    WHEN source_type = 'mdx' THEN 'doc'
    ELSE source_type
END
WHERE source_type IN ('typescript', 'python', 'mdx');

-- Step 4: After reviewing the duplicates, you can delete the temp chunks:
-- DELETE FROM docs WHERE filepath LIKE '__duplicate_%' OR chunk_id < 0;

-- Step 5: Verify no duplicates remain
SELECT 
    filepath,
    chunk_id,
    COUNT(*) as count
FROM docs
WHERE filepath NOT LIKE '__moving__%' 
  AND filepath NOT LIKE '__duplicate_%'
  AND chunk_id >= 0
GROUP BY filepath, chunk_id
HAVING COUNT(*) > 1;

