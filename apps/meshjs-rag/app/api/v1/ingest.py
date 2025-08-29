import os
from dotenv import load_dotenv
load_dotenv()
from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import pathlib
import asyncio
import openai
from supabase import AsyncClient
from tenacity import RetryError

from app.utils.get_file_paths import get_file_paths
from app.utils.get_file_content import get_file_content
from app.utils.chunk_content import chunk_content_by_h2
from app.services.openai import OpenAIService
from app.db.client import get_db_client
from app.utils.checksum import calculate_checksum
from app.utils.extract_title import extract_chunk_title

openai_api_key = os.getenv("OPENAI_KEY") or None
if openai_api_key is None:
  raise ValueError("OpenAI api key is missing")

router = APIRouter()
openai_service = OpenAIService(openai_api_key=openai_api_key)
security = HTTPBearer()

###########################################################################################################
# HELPER FUNCTIONS
###########################################################################################################

async def safe_db_operation(task):
  try:
    await task
  except Exception as e:
    print(f"Database operation failed: {e}")
    return None
  return True


async def process_file_and_update_db(file_content: str, relative_path: str, supabase: AsyncClient):
  chunks = chunk_content_by_h2(file_content)
  cache_key = calculate_checksum(file_content)
  current_chunk_data = {}

  # current chunks
  for idx, chunk in enumerate(chunks):
    chunk_title = extract_chunk_title(chunk)

    if not chunk_title:
      continue
    current_chunk_data[chunk_title] = {
      "chunk": chunk,
      "chunk_id": idx,
      "checksum": calculate_checksum(chunk)
    }

  # existing chunks
  try:
    response = await supabase.table("docs") \
                            .select("id", "chunk_title", "chunk_id", "checksum") \
                            .eq("filepath", relative_path) \
                            .execute()

    existing_records = {
      record["chunk_title"]: record
      for record in response.data
    }
  except Exception as e:
    print(f"Failed to fetch existing records for {relative_path}: {e}")
    return

  # compare
  chunks_to_embed = []
  db_operations = []

  all_keys = set(current_chunk_data.keys()) | set(existing_records.keys())

  for key in all_keys:
    chunk_title = key
    current = current_chunk_data.get(key)
    existing = existing_records.get(key)

    if current and existing:
      if current["checksum"] == existing["checksum"]:
        print(f"Skipping the unchanged chunk: {chunk_title}")

      if current["checksum"] != existing["checksum"]:
        print(f"Updating chunk: {chunk_title}")
        try:
          response = await openai_service.situate_context(file_content, current["chunk"], cache_key=cache_key)
          await asyncio.sleep(1)
          contextual_chunk = "---".join([response, current["chunk"]])
          chunks_to_embed.append(contextual_chunk)

          db_operations.append({
              "filepath": relative_path,
              "chunk_id": current["chunk_id"],
              "chunk_title": chunk_title,
              "checksum": current["checksum"],
              "content": current["chunk"],
              "record_id": existing["id"],
              "is_update": True
          })
        except (openai.APIError, openai.AuthenticationError, openai.RateLimitError, RetryError) as e:
          print(f"Skipping chunk {chunk_title} due to OpenAI 'situation_context' API error: {e}")
          continue

      elif current["chunk_id"] != existing.get("chunk_id"):
        print(f"Updating chunk order for {chunk_title}")
        await safe_db_operation(
          supabase.table("docs").update({"chunk_id": current["chunk_id"]}).eq("id", existing["id"]).execute()
        )

    elif current and not existing:
      print(f"New chunk {chunk_title}")
      try:
        response = await openai_service.situate_context(file_content, current["chunk"], cache_key=cache_key)
        await asyncio.sleep(1)
        contextual_chunk = "---".join([response, current["chunk"]])
        chunks_to_embed.append(contextual_chunk)
        db_operations.append({
            "filepath": relative_path,
            "chunk_id": current["chunk_id"],
            "chunk_title": chunk_title,
            "checksum": current["checksum"],
            "content": current["chunk"],
            "is_update": False
        })
      except (openai.APIError, openai.AuthenticationError, openai.RateLimitError, RetryError) as e:
          print(f"Skipping chunk {chunk_title} due to OpenAI 'situation_context' API error: {e}")
          continue

    elif not current and existing:
      print(f"Deleting chunk: {chunk_title}")
      await safe_db_operation(
        supabase.table("docs").delete().eq("id", existing["id"]).execute()
      )

  if chunks_to_embed:
    try:
      embeddings = await openai_service.get_batch_embeddings(chunks_to_embed)
    except (openai.APIError, openai.AuthenticationError, openai.RateLimitError, RetryError) as e:
      print(f"Skipping all DB operations for this file due to failed embedding batch: {e}")
      return

    db_tasks = []
    for i, embedding in enumerate(embeddings):
      if not embedding:
        print(f"Skipping DB operation for chunk '{db_operations[i]["chunk_title"]}' due to failed embedding")
        continue

      operation_data = db_operations[i]

      if operation_data["is_update"]:
        db_tasks.append(
          safe_db_operation(
            supabase.table("docs").update({
              "content": operation_data["content"],
              "contextual_text": chunks_to_embed[i],
              "embedding": embedding,
              "filepath": operation_data["filepath"],
              "chunk_id": operation_data["chunk_id"],
              "chunk_title": operation_data["chunk_title"],
              "checksum": operation_data["checksum"]
            }).eq("id", operation_data["record_id"]).execute()
          )
        )
      else:
        db_tasks.append(
          safe_db_operation(
            supabase.table("docs").insert({
              "content": operation_data["content"],
              "contextual_text": chunks_to_embed[i],
              "embedding": embedding,
              "filepath": operation_data["filepath"],
              "chunk_id": operation_data["chunk_id"],
              "chunk_title": operation_data["chunk_title"],
              "checksum": operation_data["checksum"]
            }).execute()
          )
        )

    await asyncio.gather(*db_tasks)


###########################################################################################################
# ENDPOINTS
###########################################################################################################

@router.post("/")
async def ingest_docs(credentials: HTTPAuthorizationCredentials = Depends(security), supabase: AsyncClient = Depends(get_db_client)):

  token = credentials.credentials
  if not token or token != os.getenv("ADMIN_KEY"):
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="You are not authorized"
    )

  docs_dir = pathlib.Path(__file__).resolve().parents[3] / "docs"

  try:
    file_paths = get_file_paths(docs_dir)
  except FileNotFoundError as e:
    raise HTTPException(
      status_code=status.HTTP_404_NOT_FOUND,
      detail=f"The documents directory was not found: {e}"
    )
  except IOError as e:
    raise HTTPException(
      status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
      detail=f"An I/O error occurred while accessing the documents directory: {e}"
    )

  for relative_path in file_paths:
    abs_path = docs_dir / relative_path
    try:
      file_content = get_file_content(abs_path)
      await process_file_and_update_db(file_content, relative_path, supabase)
    except (FileNotFoundError, IOError) as e:
      print(f"Skipping file due to error: {e}")
      continue

    except Exception as e:
      raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"An error occured during the file ingestion: {e}"
      )

  return {
    "message": "Ingestion process successfully completed"
  }