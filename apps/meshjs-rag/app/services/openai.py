from openai import AsyncOpenAI
from typing import List
from tenacity import retry, wait_random_exponential, stop_after_attempt
import json

DOCUMENT_CONTEXT_PROMPT = """
<document>
{doc_content}
</document>
"""

CHUNK_CONTEXT_PROMPT = """
Here is the chunk we want to situate within the whole document
<chunk>
{chunk_content}
</chunk>

Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk.
Answer only with the succinct context and nothing else.
"""

class OpenAIService:
  def __init__(self, openai_api_key):
    self.client = AsyncOpenAI(api_key=openai_api_key)

  @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(6))
  async def _chat(self, messages, model="gpt-4o-mini", temperature=0.0, max_tokens=None, prompt_cache_key=None, stream: bool = False):
    kwargs = {
      "model": model,
      "messages": messages,
      "temperature": temperature,
      "stream": stream
    }

    if prompt_cache_key:
      kwargs["prompt_cache_key"] = prompt_cache_key
    if max_tokens:
      kwargs["max_tokens"] = max_tokens

    return await self.client.chat.completions.create(**kwargs)

  async def situate_context(self, doc: str, chunk: str, cache_key: str) -> str:
    messages = [
      {
        "role": "user",
        "content": DOCUMENT_CONTEXT_PROMPT.format(doc_content=doc)
      },
      {
        "role": "user",
        "content": CHUNK_CONTEXT_PROMPT.format(chunk_content=chunk)
      }
    ]

    response = await self._chat(messages=messages, max_tokens=1024, prompt_cache_key=cache_key)
    return response.choices[0].message.content

  @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(6), reraise=True)
  async def get_batch_embeddings(self, texts: List[str]) -> List[List[float]]:
    response = await self.client.embeddings.create(
      model="text-embedding-3-small",
      input=texts,
      encoding_format="float"
    )

    return [data.embedding for data in response.data]

  @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(6), reraise=True)
  async def embed_query(self, text: str) -> List[float]:
    response = await self.client.embeddings.create(
      model="text-embedding-3-small",
      input=text,
      encoding_format="float"
    )

    return response.data[0].embedding

  @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(6), reraise=True)
  async def get_answer_streaming(self, question: str, context: str, model="gpt-4o-mini"):
    messages = [
      {
        "role": "system",
        "content": "You are a MeshJS expert assistant. Help developers with MeshJS questions using the provided context.\n\nUse the documentation context to answer questions about MeshJS and Cardano development. Provide accurate code examples and explanations based on the context provided.\n\nWhen answering:\n- Give direct, helpful answers based on the context\n- Include relevant code examples when available\n- Explain concepts clearly for developers\n- Include any links present in the context for additional resources\n- If the context doesn't cover something, say so\n- Don't make up APIs or methods not in the documentation\n\nBe concise but thorough. Focus on practical, actionable guidance for MeshJS development."
      },
      {
        "role": "user",
        "content": f"""Context: {context}\n\nQuestion: {question}""",
      }
    ]

    stream = await self._chat(messages=messages, stream=True, model=model)

    async for chunk in stream:
      yield f"data: {json.dumps(chunk.model_dump())}\n\n"

    yield "data: [DONE]\n\n"


  @retry(wait=wait_random_exponential(min=1, max=60), stop=stop_after_attempt(6), reraise=True)
  async def get_answer(self, question: str, context: str, model="gpt-4o-mini"):
    messages = [
      {
        "role": "system",
        "content": "You are a MeshJS expert assistant. Help developers with MeshJS questions using the provided context.\n\nUse the documentation context to answer questions about MeshJS and Cardano development. Provide accurate code examples and explanations based on the context provided.\n\nWhen answering:\n- Give direct, helpful answers based on the context\n- Include relevant code examples when available\n- Explain concepts clearly for developers\n- Include any links present in the context for additional resources\n- If the context doesn't cover something, say so\n- Don't make up APIs or methods not in the documentation\n\nBe concise but thorough. Focus on practical, actionable guidance for MeshJS development."
      },
      {
        "role": "user",
        "content": f"""Context: {context}\n\nQuestion: {question}""",
      }
    ]

    response = await self._chat(messages=messages, stream=False, model=model)
    return response.choices[0].message.content