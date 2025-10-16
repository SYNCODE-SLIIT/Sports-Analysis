"""
Planner + writer chatbot service.

The pipeline now works as:
  1. Planner model analyses the user prompt and decides which web searches to run.
  2. Each search query runs sequentially against Tavily.
  3. Results are aggregated into a structured context block.
  4. Writer model consumes the context (plus planner guidance) to produce the final answer.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests


class ChatbotServiceError(Exception):
    """Raised when the chatbot pipeline cannot complete successfully."""

    def __init__(
        self,
        message: str,
        *,
        code: str = "service_error",
        details: Optional[Dict[str, Any]] = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.details = details or {}


# Temperatures read once; override via env if desired.
PLANNER_TEMPERATURE = float(os.getenv("GROQ_PLANNER_TEMPERATURE", "0.1"))
WRITER_TEMPERATURE = float(os.getenv("GROQ_WRITER_TEMPERATURE", "0.2"))
MAX_HISTORY_MESSAGES = int(os.getenv("CHATBOT_HISTORY_LIMIT", "12"))


def _get_tavily_api_key() -> str:
    return (os.getenv("TAVIL_API_KEY") or os.getenv("TAVILY_API_KEY") or "").strip()


def _get_groq_api_key() -> str:
    return (os.getenv("GROQ_API_KEY") or "").strip()


def _get_default_writer_model() -> str:
    return "llama3-70b-8192"


def _get_default_planner_model() -> str:
    return "llama3-8b-8192"


def _get_writer_model() -> str:
    return (
        os.getenv("GROQ_WRITER_MODEL")
        or os.getenv("GROQ_MODEL")
        or _get_default_writer_model()
    ).strip()


def _get_planner_model() -> str:
    return (
        os.getenv("GROQ_PLANNER_MODEL")
        or os.getenv("GROQ_MODEL")
        or _get_default_planner_model()
    ).strip()


def _ensure_api_keys() -> None:
    if not _get_tavily_api_key():
        raise ChatbotServiceError(
            "Missing Tavily API key. Set TAVIL_API_KEY or TAVILY_API_KEY in the environment.",
            code="missing_credentials",
        )
    if not _get_groq_api_key():
        raise ChatbotServiceError(
            "Missing Groq API key. Set GROQ_API_KEY in the environment.",
            code="missing_credentials",
        )


def _safe_post(url: str, *, timeout: int = 45, **kwargs: Any) -> requests.Response:
    """Wrapper around requests.post with uniform error handling."""
    try:
        response = requests.post(url, timeout=timeout, **kwargs)
        response.raise_for_status()
        return response
    except requests.HTTPError as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        detail: Dict[str, Any] = {"status_code": status_code, "url": url}
        if exc.response is not None:
            try:
                detail["body"] = exc.response.json()
            except Exception:
                detail["body"] = exc.response.text
        raise ChatbotServiceError(
            f"POST {url} failed with status {status_code if status_code is not None else 'unknown'}",
            code="http_error",
            details=detail,
        ) from exc
    except requests.RequestException as exc:  # pragma: no cover - defensive
        raise ChatbotServiceError(
            f"POST {url} failed: {exc}",
            code="network_error",
            details={"url": url, "error": str(exc)},
        ) from exc


def _call_groq_chat(
    messages: List[Dict[str, str]],
    *,
    model: str,
    temperature: float,
) -> str:
    """Invoke Groq chat completion with shared plumbing."""
    _ensure_api_keys()
    api_key = _get_groq_api_key()
    if not model:
        raise ChatbotServiceError("Groq model name is not configured.", code="missing_configuration")

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": messages, "temperature": temperature, "stream": False}

    response = _safe_post(url, headers=headers, json=payload)
    try:
        data = response.json()
        return data["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError) as exc:
        raise ChatbotServiceError("Groq returned an unexpected payload.", code="invalid_response") from exc


def _coerce_json_block(text: str) -> Dict[str, Any]:
    """Attempt to coerce the planner response into JSON."""
    cleaned = text.strip()
    if not cleaned:
        raise ChatbotServiceError("Planner response was empty.", code="planner_empty")

    # Handle fenced code blocks (```json ... ```)
    if "```" in cleaned:
        matches = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, flags=re.DOTALL)
        if matches:
            cleaned = matches[0].strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        obj_match = re.search(r"\{.*\}", cleaned, flags=re.DOTALL)
        if obj_match:
            try:
                return json.loads(obj_match.group())
            except json.JSONDecodeError as exc:
                raise ChatbotServiceError("Planner returned malformed JSON.", code="planner_invalid_json") from exc
        raise ChatbotServiceError("Planner returned non-JSON response.", code="planner_invalid_json")


def _tavily_search(query: str, *, max_results: int = 5) -> Dict[str, Any]:
    _ensure_api_keys()
    if not query or not query.strip():
        raise ChatbotServiceError("Query must be a non-empty string.", code="invalid_request")

    safe_results = max(1, min(max_results, 10))
    url = "https://api.tavily.com/search"
    headers = {"Authorization": f"Bearer {_get_tavily_api_key()}"}
    payload = {"query": query.strip(), "max_results": safe_results}
    response = _safe_post(url, headers=headers, json=payload)
    try:
        return response.json()
    except ValueError as exc:  # pragma: no cover - Tavily normally returns JSON
        raise ChatbotServiceError("Tavily returned malformed JSON.", code="invalid_response") from exc


def normalize_tavily(
    raw: Dict[str, Any] | None,
    *,
    limit: Optional[int] = None,
    source_query: str | None = None,
) -> List[Dict[str, Any]]:
    """Convert the Tavily payload into a deduplicated citation list."""
    if not isinstance(raw, dict):
        return []

    limit_eff = max(1, limit) if limit else None

    items: List[Dict[str, Any]] = []
    for result in raw.get("results", []) or []:
        if not isinstance(result, dict):
            continue
        items.append(
            {
                "title": result.get("title"),
                "url": result.get("url"),
                "snippet": result.get("content") or "",
                "score": result.get("score"),
                "source_query": source_query,
            }
        )

    seen: set[str] = set()
    unique: List[Dict[str, Any]] = []
    for item in items:
        url = item.get("url")
        if url and url not in seen:
            seen.add(url)
            unique.append(item)
        if limit_eff and len(unique) >= limit_eff:
            break
    return unique


def _build_writer_context(groups: Iterable[Dict[str, Any]]) -> str:
    """Render grouped search results into a structured writer context."""
    blocks: List[str] = []
    for group in groups:
        query = group.get("query") or "Unknown query"
        section: List[str] = [f"### Search Query: {query}"]
        results = group.get("results") or []
        if not results:
            section.append("No results were returned for this query.")
        for idx, result in enumerate(results, start=1):
            title = result.get("title") or "Untitled result"
            snippet = result.get("snippet") or ""
            url = result.get("url") or ""
            section.append(f"[{idx}] {title}\n{snippet}\nSource: {url}")
        blocks.append("\n".join(section))

    if not blocks:
        return "No relevant web results were found for this question."
    return "\n\n----\n\n".join(blocks)


def _collect_unique_citations(groups: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return a deduplicated list of citations across all groups."""
    seen: set[str] = set()
    citations: List[Dict[str, Any]] = []
    for group in groups:
        for item in group.get("results") or []:
            url = item.get("url")
            if url and url not in seen:
                seen.add(url)
                citations.append(
                    {
                        "title": item.get("title"),
                        "url": url,
                        "snippet": item.get("snippet") or "",
                        "score": item.get("score"),
                        "source_query": item.get("source_query"),
                    }
                )
    return citations


def _sanitize_history(raw_history: Optional[List[Dict[str, Any]]]) -> List[Dict[str, str]]:
    """Normalize chat history entries to a bounded list with stable roles."""
    if not raw_history:
        return []

    cleaned: List[Dict[str, str]] = []
    for item in raw_history:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        content = str(item.get("content") or "").strip()
        if role not in {"user", "assistant"}:
            continue
        if not content:
            continue
        cleaned.append({"role": role, "content": content})

    if not cleaned:
        return []

    limit = max(1, MAX_HISTORY_MESSAGES)
    if len(cleaned) > limit:
        cleaned = cleaned[-limit:]
    return cleaned


def _format_history(history: List[Dict[str, str]]) -> str:
    """Render history (oldest first) into a readable transcript for prompts."""
    if not history:
        return ""
    lines: List[str] = []
    for msg in history:
        speaker = "User" if msg["role"] == "user" else "Assistant"
        lines.append(f"{speaker}: {msg['content']}")
    return "\n".join(lines)


def _plan_search_queries(question: str, *, user_top_k: int, history_text: str) -> Dict[str, Any]:
    """Use the planner model to determine web search strategy."""
    system_msg = (
        "You are an expert research planner for a sports-focused assistant. "
        "You focus on the sport soccer/football. "
        "Break complex sports questions into targeted web searches. "
        "All searches and reasoning must stay within sports topics."
    )

    conversation_section = ""
    if history_text:
        conversation_section = (
            "Conversation so far (oldest first, most recent last):\n"
            f"{history_text}\n\n"
            "Use the conversation to resolve references such as pronouns or 'that match'.\n\n"
        )

    user_prompt = (
        f"{conversation_section}"
        "Plan the research steps for the following user request.\n"
        "Return strict JSON with keys:\n"
        '  "queries": list of objects { "query": string, "max_results": int between 3 and 10 };\n'
        '  "writer_instructions": string guidance describing how the writer should structure the final answer;\n'
        '  "notes": optional string for additional hints.\n'
        "Make between 1 and 4 queries depending on coverage. Ensure coverage if the user references multiple leagues, "
        "teams, players, or time ranges. Always keep the scope to sports topics.\n"
        f"User requested citation budget: {user_top_k} unique sources.\n"
        "Example output:\n"
        '{\n'
        '  "queries": [\n'
        '    {"query": "latest Premier League match summaries April 2024", "max_results": 5},\n'
        '    {"query": "La Liga match results April 2024 key players", "max_results": 5}\n'
        '  ],\n'
        '  "writer_instructions": "Compare performances across leagues, highlight standout players, cite each league separately.",\n'
        '  "notes": "Focus on results within the last 7 days."\n'
        '}\n'
        "Latest user question:\n"
        f"{question}"
    )
    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": user_prompt},
    ]
    raw_plan = _call_groq_chat(messages, model=_get_planner_model(), temperature=PLANNER_TEMPERATURE)
    plan = _coerce_json_block(raw_plan)

    queries = plan.get("queries")
    if not isinstance(queries, list) or not queries:
        queries = [{"query": question, "max_results": max(3, min(user_top_k, 6))}]
        plan["queries"] = queries

    normalized_queries: List[Dict[str, Any]] = []
    for item in queries[:4]:
        if not isinstance(item, dict):
            continue
        query_text = str(item.get("query") or "").strip()
        if not query_text:
            continue
        max_results = item.get("max_results")
        try:
            max_results_int = int(max_results) if max_results is not None else max(3, min(user_top_k, 6))
        except (ValueError, TypeError):
            max_results_int = max(3, min(user_top_k, 6))
        max_results_int = max(3, min(max_results_int, 10))
        normalized_queries.append({"query": query_text, "max_results": max_results_int})

    if not normalized_queries:
        normalized_queries = [{"query": question.strip(), "max_results": max(3, min(user_top_k, 6))}]

    plan["queries"] = normalized_queries
    if "writer_instructions" not in plan or not isinstance(plan["writer_instructions"], str):
        plan["writer_instructions"] = "Provide a concise sports-focused answer with sub-headings for each topic."
    return plan


def _execute_search_plan(plan: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Run Tavily searches for each planned query."""
    groups: List[Dict[str, Any]] = []
    for item in plan.get("queries", []):
        query = item.get("query")
        max_results = item.get("max_results", 5)
        try:
            max_results_int = int(max_results)
        except (ValueError, TypeError):
            max_results_int = 5
        max_results_int = max(1, min(max_results_int, 10))

        tavily_payload = _tavily_search(str(query), max_results=max_results_int)
        normalized = normalize_tavily(tavily_payload, limit=max_results_int, source_query=str(query))
        groups.append({"query": query, "max_results": max_results_int, "results": normalized})

    citations = _collect_unique_citations(groups)
    return groups, citations


def _ask_writer(
    question: str,
    *,
    plan: Dict[str, Any],
    context: str,
    citations: List[Dict[str, Any]],
    history_text: str,
) -> str:
    """Call the writer model to craft the final response."""
    writer_instructions = plan.get("writer_instructions", "")
    notes = plan.get("notes", "")
    system_msg = (
        "You are a concise sports analyst. Use ONLY the supplied web context to answer factual questions. "
        "You only answer for soccer/football related questions, Do not provide any answers for content not related to sports. If unrelated questions were asked, reply I’m sorry, but I only handle questions related to sports. "
        "If information is missing, say so. Do not make up fauls information"
    )
    citations_text = "\n".join(f"- {c.get('url')}" for c in citations if c.get("url"))
    conversation_section = ""
    if history_text:
        conversation_section = (
            "Conversation so far (oldest first, most recent last):\n"
            f"{history_text}\n\n"
            "Respond to the latest user question using this context.\n\n"
        )

    user_content = (
        f"{conversation_section}"
        f"Latest user question:\n{question}\n\n"
        f"Planner guidance:\n{writer_instructions}\n\n"
        + (f"Additional planner notes: {notes}\n\n" if notes else "")
        + "Web search context:\n"
        f"{context}\n\n"
        "Sources collected:\n"
        f"{citations_text or 'None'}"
    )

    messages = [
        {"role": "system", "content": system_msg},
        {"role": "user", "content": user_content},
    ]
    return _call_groq_chat(messages, model=_get_writer_model(), temperature=WRITER_TEMPERATURE)


def ask_with_web_search(
    user_query: str,
    *,
    top_k: int = 5,
    history: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Run planner → multi-search → writer pipeline and return the answer."""
    if not isinstance(top_k, int):
        raise ChatbotServiceError("top_k must be an integer.", code="invalid_request")
    top_k_clamped = max(1, min(top_k, 10))

    history_clean = _sanitize_history(history)
    history_text = _format_history(history_clean)

    plan = _plan_search_queries(user_query, user_top_k=top_k_clamped, history_text=history_text)
    groups, citations = _execute_search_plan(plan)
    context = _build_writer_context(groups)
    answer = _ask_writer(
        user_query,
        plan=plan,
        context=context,
        citations=citations,
        history_text=history_text,
    )

    limited_citations = citations[:top_k_clamped]
    return {
        "answer": answer,
        "citations": limited_citations,
        "plan": plan,
        "meta": {
            "unique_citations": len(citations),
            "groups": len(groups),
            "history_messages_used": len(history_clean),
            "history_truncated": bool(history) and len(history or []) > len(history_clean),
        },
    }
