from typing import List
from supabase import AsyncClient

from app.utils.extract_github_links import extract_github_links

PACKAGES = ["mesh-common", "mesh-core-csl", "mesh-contract", "mesh-provider", "mesh-transaction", "mesh-wallet"]

async def get_context(embedded_query: List[float], supabase: AsyncClient) -> str:
  response = await supabase.rpc("match_docs", {
    "query_embedding": embedded_query,
    "match_threshold": 0.2,
    "match_count": 5
  }).execute()

  final_contextual_data = ""
  if response.data:
    for data in response.data:
      if not str(data["filepath"]).startswith(tuple(PACKAGES)):
        file_location = f"location: https://meshjs.dev/{data["filepath"].replace(".mdx", "")}"
      else:
        links = "\n".join(extract_github_links(data["contextual_text"]))
        file_location = f"location: {links}" if links else ""

      contextual_data = data["contextual_text"] + "\n\n" + file_location + "\n\n" if file_location else data["contextual_text"] + "\n\n"
      final_contextual_data += contextual_data if contextual_data else ""

  if final_contextual_data:
    return final_contextual_data
  else:
    return "No relevant context found."