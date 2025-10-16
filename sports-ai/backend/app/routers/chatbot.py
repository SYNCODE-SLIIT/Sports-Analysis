from __future__ import annotations

from fastapi import APIRouter, HTTPException
from typing import Any, Dict
from starlette.concurrency import run_in_threadpool

from ..schemas.chatbot import ChatbotRequest, ChatbotResponse, ChatCitation
from ..services.chatbot import ChatbotServiceError, ask_with_web_search


router = APIRouter(prefix="/chatbot", tags=["chatbot"])


@router.post("/web-search", response_model=ChatbotResponse)
async def chatbot_web_search(payload: ChatbotRequest) -> ChatbotResponse:
    try:
        result = await run_in_threadpool(
            ask_with_web_search,
            payload.question,
            top_k=payload.top_k,
            history=[msg.model_dump() for msg in payload.history],
        )
    except ChatbotServiceError as exc:
        status_map = {
            "invalid_request": 400,
            "missing_credentials": 500,
            "planner_empty": 502,
            "planner_invalid_json": 502,
            "http_error": 502,
            "network_error": 502,
        }
        status_code = status_map.get(exc.code, 500)
        raise HTTPException(
            status_code=status_code,
            detail={"code": exc.code, "message": str(exc), "details": exc.details},
        )

    citations = [ChatCitation(**item) for item in result.get("citations", [])]
    meta_payload: Dict[str, Any] = {"top_k": payload.top_k}
    meta_payload.update(result.get("meta") or {})
    meta_payload["plan"] = result.get("plan")
    return ChatbotResponse(
        answer=result.get("answer", ""),
        citations=citations,
        meta=meta_payload,
    )
