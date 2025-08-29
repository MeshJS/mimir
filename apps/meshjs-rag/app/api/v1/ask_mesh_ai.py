from typing import Literal, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Header
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from supabase import AsyncClient
import openai
from dotenv import load_dotenv
load_dotenv()
import os

from app.services.openai import OpenAIService
from app.utils.get_context import get_context
from app.db.client import get_db_client


router = APIRouter()
security = HTTPBearer()

###########################################################################################################
# MODELS
###########################################################################################################
class ChatMessage(BaseModel):
  role: Literal["system", "user", "assistant"]
  content: str

class ChatCompletionRequest(BaseModel):
  model: str
  messages: List[ChatMessage]
  stream: Optional[bool] = False

class MCPRequestBody(BaseModel):
  query: str
  model: str

###########################################################################################################
# ENDPOINTS
###########################################################################################################
@router.post("/chat/completions")
async def ask_mesh_ai(body: ChatCompletionRequest, credentials: HTTPAuthorizationCredentials = Depends(security), supabase: AsyncClient = Depends(get_db_client)):

  token = credentials.credentials
  if not token or token != os.getenv("ADMIN_KEY"):
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="You are not authorized"
    )

  openai_api_key = os.getenv("OPENAI_KEY") or None
  if openai_api_key is None:
    raise ValueError("OpenAI api key is missing")

  openai_service = OpenAIService(openai_api_key)

  try:
    question = body.messages[-1].content

    embedded_query = await openai_service.embed_query(question)
    context = await get_context(embedded_query, supabase)
    generator = openai_service.get_answer_streaming(question=question, context=context)
    return StreamingResponse(generator, media_type="text/event-stream")

  except (openai.APIError, openai.AuthenticationError, openai.RateLimitError) as e:
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail=f"An OpenAI API error occurred: {e}"
    )
  except Exception as e:
    raise HTTPException(
      status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
      detail=f"An unexpected error occurred: {e}"
    )

##############################################################################################################
@router.post("/mcp")
async def ask_mesh_ai(body: MCPRequestBody, authorization: str = Header(None), supabase: AsyncClient = Depends(get_db_client)):

  if not authorization or not authorization.startswith("Bearer"):
    print("error")
    raise HTTPException(
      status_code=status.HTTP_401_UNAUTHORIZED,
      detail="You are not authorized"
    )

  try:
    openai_api_key = authorization.split(" ")[-1]
    openai_service = OpenAIService(openai_api_key)

    question = body.query
    model = body.model

    embedded_query = await openai_service.embed_query(question)
    context = await get_context(embedded_query, supabase)
    response = await openai_service.get_answer(question=question, context=context, model=model)
    return response

  except (openai.APIError, openai.AuthenticationError, openai.RateLimitError) as e:
    print(e)
    raise HTTPException(
      status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
      detail=f"An OpenAI API error occurred: {e}"
    )
  except Exception as e:
    print(e)
    raise HTTPException(
      status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
      detail=f"An unexpected error occurred: {e}"
    )