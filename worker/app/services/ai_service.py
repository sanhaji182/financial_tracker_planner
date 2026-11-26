from datetime import datetime, timedelta
import asyncio
import json
import logging
import base64
import os
import re
import uuid
from typing import AsyncGenerator, Dict, Any, List, Optional, Tuple
import httpx

logger = logging.getLogger("worker.ai")

def detect_image_mime(image_base64: str, filename: str = "") -> str:
    """Detects image MIME type from base64 signature with filename fallback."""
    clean_b64 = image_base64.strip()
    if "," in clean_b64 and clean_b64.startswith("data:"):
        header, _, _ = clean_b64.partition(",")
        if ";" in header and ":" in header:
            return header.split(":", 1)[1].split(";", 1)[0]

    if clean_b64.startswith("iVBOR"):
        return "image/png"
    if clean_b64.startswith("UklGR"):
        return "image/webp"
    if clean_b64.startswith("R0lGOD"):
        return "image/gif"
    if clean_b64.startswith("/9j/"):
        return "image/jpeg"

    lower = (filename or "").lower()
    if lower.endswith(".png"):
        return "image/png"
    if lower.endswith(".webp"):
        return "image/webp"
    if lower.endswith(".gif"):
        return "image/gif"
    return "image/jpeg"


def _normalize_ocr_items(raw_items: Any) -> List[Dict[str, Any]]:
    normalized: List[Dict[str, Any]] = []
    if not isinstance(raw_items, list):
        return normalized
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        qty_raw = item.get("quantity", item.get("qty", 1))
        try:
            qty = max(1, int(qty_raw))
        except (TypeError, ValueError):
            qty = 1
        try:
            price = float(item.get("price", 0) or 0)
        except (TypeError, ValueError):
            price = 0.0
        try:
            total = float(item.get("total", price * qty) or 0)
        except (TypeError, ValueError):
            total = price * qty
        normalized.append(
            {
                "name": name,
                "quantity": qty,
                "price": price,
                "total": total,
            }
        )
    return normalized


def _extract_json_text(content: str) -> Dict[str, Any]:
    cleaned = content.strip()
    if "```json" in cleaned:
        cleaned = cleaned.split("```json", 1)[1].split("```", 1)[0].strip()
    elif "```" in cleaned:
        cleaned = cleaned.split("```", 1)[1].split("```", 1)[0].strip()
    return json.loads(cleaned)


def openai_compatible_base_url() -> str:
    """Base URL for OpenAI-compatible providers (OpenAI, 9r, LiteLLM, etc)."""
    return (
        os.getenv("OPENAI_BASE_URL")
        or os.getenv("AI_BASE_URL")
        or "https://api.openai.com/v1"
    ).rstrip("/")


def openai_chat_completions_url() -> str:
    return f"{openai_compatible_base_url()}/chat/completions"


async def call_openai_chat(
    *,
    api_key: str,
    model: str,
    messages: list,
    temperature: float = 0.7,
    timeout: float = 30.0,
    response_format: Optional[dict] = None,
    max_tokens: Optional[int] = None,
) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if response_format is not None:
        payload["response_format"] = response_format
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens

    url = openai_chat_completions_url()
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.post(url, json=payload, headers=headers)
        # Some OpenAI-compatible proxies reject response_format; retry without it.
        if resp.status_code >= 400 and response_format is not None:
            logger.warning(
                "OpenAI-compatible chat failed with response_format (%s). Retrying without it.",
                resp.status_code,
            )
            payload.pop("response_format", None)
            resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        result_json = resp.json()
        return result_json["choices"][0]["message"]["content"]

# 1. OCR Enhancement Service
async def enhance_ocr_llm(
    ocr_result: Dict[str, Any],
    image_base64: str,
    provider: str,
    model_name: str,
    api_key: Optional[str],
    filename: str = ""
) -> Dict[str, Any]:
    """
    Escalates OCR corrections to an LLM (OpenAI / Anthropic / Gemini) if confidence is low.
    If no API key is provided, falls back to a smart heuristic-based corrector.
    """
    if not api_key or provider == "local":
        logger.info("Using mock/heuristic OCR enhancement")
        return mock_enhance_ocr(ocr_result)

    clean_b64 = image_base64.split(",", 1)[1] if image_base64.startswith("data:") and "," in image_base64 else image_base64
    mime_type = detect_image_mime(image_base64, filename)
    raw_text = ocr_result.get("raw_text", "")
    existing_scores = ocr_result.get("confidence_scores") or {}

    prompt = (
        "You are an expert OCR parser for Indonesian shopping receipts and invoices. "
        "The following receipt was parsed using basic OCR with these raw results:\n"
        f"{json.dumps(ocr_result.get('parsed_data', {}), indent=2)}\n\n"
        f"Raw OCR Text:\n{raw_text}\n\n"
        "Please look at the attached receipt image and the raw OCR data, "
        "correct any spelling errors, extract itemized lines accurately, verify the date (YYYY-MM-DD), payment method, "
        "and verify the grand total amount. "
        "Return ONLY a raw JSON object matching this schema, without markdown formatting:\n"
        "{\n"
        "  \"merchant_name\": \"string\",\n"
        "  \"date\": \"YYYY-MM-DD\",\n"
        "  \"items\": [{\"name\": \"string\", \"quantity\": int, \"price\": float, \"total\": float}],\n"
        "  \"total\": float,\n"
        "  \"payment_method\": \"string\"\n"
        "}"
    )

    try:
        parsed_data: Optional[Dict[str, Any]] = None
        if provider == "openai":
            llm_model = model_name if model_name != "default" else "gpt-4o-mini"
            content = await call_openai_chat(
                api_key=api_key,
                model=llm_model,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime_type};base64,{clean_b64}"
                                },
                            },
                        ]
                        if clean_b64
                        else prompt,
                    }
                ],
                temperature=0.1,
                timeout=45.0,
                response_format={"type": "json_object"},
            )
            parsed_data = _extract_json_text(content)
        elif provider == "anthropic":
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json"
            }
            llm_model = model_name if model_name != "default" else "claude-3-5-sonnet-20241022"
            payload = {
                "model": llm_model,
                "max_tokens": 1200,
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": mime_type,
                                    "data": clean_b64
                                }
                            },
                            {
                                "type": "text",
                                "text": prompt + "\nRemember, return only the JSON object."
                            }
                        ]
                    }
                ],
                "temperature": 0.1
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
                resp.raise_for_status()
                content = resp.json()["content"][0]["text"]
                parsed_data = _extract_json_text(content)
        elif provider == "gemini":
            llm_model = model_name if model_name != "default" else "gemini-2.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{llm_model}:generateContent?key={api_key}"
            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt},
                            {
                                "inline_data": {
                                    "mime_type": mime_type,
                                    "data": clean_b64
                                }
                            }
                        ]
                    }
                ],
                "generationConfig": {
                    "temperature": 0.1,
                    "responseMimeType": "application/json"
                }
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                parsed_data = _extract_json_text(content)

        if parsed_data is not None:
            parsed_data["items"] = _normalize_ocr_items(parsed_data.get("items"))
            return {
                "raw_text": raw_text,
                "engine": f"ai_vision ({provider})",
                "parsed_data": parsed_data,
                "confidence_scores": existing_scores or {
                    "merchant_name": 0.95,
                    "date": 0.95,
                    "total": 0.95,
                    "payment_method": 0.95,
                },
                "overall_confidence": 0.95,
                "needs_review": False,
            }
    except Exception as e:
        logger.error(f"Error calling {provider} for OCR enhancement: {str(e)}")
        return mock_enhance_ocr(ocr_result)

    return mock_enhance_ocr(ocr_result)


def mock_enhance_ocr(ocr_result: Dict[str, Any]) -> Dict[str, Any]:
    """Smart fallback OCR corrector."""
    data = ocr_result.get("parsed_data", {}).copy()
    merchant = data.get("merchant_name", "")

    merchant_mapping = {
        "ind0maret": "Indomaret",
        "indomart": "Indomaret",
        "alfamrt": "Alfamart",
        "alfa mart": "Alfamart",
        "superindo": "Superindo",
        "carefor": "Carrefour",
        "starbuck": "Starbucks",
        "starbuc": "Starbucks"
    }
    for old, new in merchant_mapping.items():
        if old in merchant.lower():
            data["merchant_name"] = new
            break

    items = _normalize_ocr_items(data.get("items", []))
    data["items"] = items
    if items:
        calculated_total = sum(item.get("total", item.get("price", 0) * item.get("quantity", 1)) for item in items)
        if data.get("total", 0) <= 0 or abs(data.get("total", 0) - calculated_total) > 100:
            data["total"] = calculated_total

    date_val = data.get("date", "")
    if "/" in date_val:
        parts = date_val.split("/")
        if len(parts) == 3:
            if len(parts[2]) == 4:
                data["date"] = f"{parts[2]}-{parts[1]}-{parts[0]}"
            elif len(parts[0]) == 4:
                data["date"] = f"{parts[0]}-{parts[1]}-{parts[2]}"

    return {
        "raw_text": ocr_result.get("raw_text", ""),
        "engine": ocr_result.get("engine", "heuristic"),
        "parsed_data": data,
        "confidence_scores": ocr_result.get("confidence_scores") or {},
        "overall_confidence": 0.95,
        "needs_review": not data.get("date") or data.get("total", 0) <= 0,
    }


# 2. Auto-Categorization Service
async def categorize_transaction(
    description: str,
    amount: float,
    merchant: str,
    available_categories: List[Dict[str, str]],
    provider: str,
    model_name: str,
    api_key: Optional[str]
) -> Dict[str, Any]:
    """
    Suggests a category for a transaction description.
    If no API key is provided, falls back to keyword matching.
    """
    if not api_key or provider == "local":
        logger.info("Using mock/heuristic auto-categorization")
        return mock_categorize(description, merchant, available_categories)

    categories_str = "\n".join([f"- ID: {c['id']}, Name: {c['name']}" for c in available_categories])
    prompt = (
        "You are a personal financial categorization assistant. "
        "Given the following transaction details, classify it into EXACTLY ONE category from the list below.\n\n"
        f"Transaction Details:\n"
        f"- Description: {description}\n"
        f"- Merchant: {merchant}\n"
        f"- Amount: {amount}\n\n"
        f"Available Categories:\n{categories_str}\n\n"
        "Return ONLY a raw JSON object with no markdown styling, formatted like this:\n"
        "{\n"
        "  \"category_id\": \"matching-uuid-here\",\n"
        "  \"category_name\": \"matching-category-name-here\",\n"
        "  \"confidence\": float_score_between_0_and_1\n"
        "}"
    )

    try:
        headers = {
            "Authorization": f"Bearer {api_key}" if provider == "openai" else "",
            "x-api-key": api_key if provider == "anthropic" else "",
            "Content-Type": "application/json"
        }
        
        if provider == "openai":
            llm_model = model_name if model_name != "default" else "gpt-4o-mini"
            content = await call_openai_chat(
                api_key=api_key,
                model=llm_model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,
                timeout=30.0,
                response_format={"type": "json_object"},
            )
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            return json.loads(content.strip())
        elif provider == "anthropic":
            headers["anthropic-version"] = "2023-06-01"
            llm_model = model_name if model_name != "default" else "claude-3-haiku-20240307"
            payload = {
                "model": llm_model,
                "max_tokens": 500,
                "messages": [{"role": "user", "content": prompt + "\nRemember, return only the JSON object."}],
                "temperature": 0.0
            }
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
                resp.raise_for_status()
                content = resp.json()["content"][0]["text"]
                return _extract_json_text(content)
        elif provider == "gemini":
            llm_model = model_name if model_name != "default" else "gemini-2.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{llm_model}:generateContent?key={api_key}"
            payload = {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json"},
            }
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                return _extract_json_text(content)
    except Exception as e:
        logger.error(f"Error calling {provider} for auto-categorization: {str(e)}")
        return mock_categorize(description, merchant, available_categories)

    return mock_categorize(description, merchant, available_categories)


def mock_categorize(description: str, merchant: str, available_categories: List[Dict[str, str]]) -> Dict[str, Any]:
    text = (description + " " + merchant).lower()
    
    # Simple mapping keyword -> category name substrings
    keywords = {
        "makan": ["makan", "minum", "restoran", "food", "cafe", "starbucks", "kopi", "warung", "kfc", "mcd"],
        "belanja": ["belanja", "superindo", "indomaret", "alfamart", "shopee", "tokopedia", "baju", "mall", "market"],
        "transportasi": ["transport", "gojek", "grab", "uber", "bensin", "pertamina", "shell", "tol", "parkir", "mrt"],
        "tagihan": ["listrik", "pln", "air", "pdam", "internet", "wifi", "indihome", "pulsa", "telkomsel", "bpjs"],
        "investasi": ["reksadana", "saham", "crypto", "bibit", "bareksa", "emiten", "invest", "obligasi"],
        "hiburan": ["nonton", "bioskop", "netflix", "spotify", "game", "steam", "travel", "tiket", "hotel"]
    }

    matched_type = ""
    for category_type, keys in keywords.items():
        if any(k in text for k in keys):
            matched_type = category_type
            break

    # Look up matched category in available categories list
    if matched_type:
        for cat in available_categories:
            cat_name = cat["name"].lower()
            if matched_type == "makan" and ("makan" in cat_name or "kuliner" in cat_name or "food" in cat_name):
                return {"category_id": cat["id"], "category_name": cat["name"], "confidence": 0.90}
            if matched_type == "belanja" and ("belanja" in cat_name or "pokok" in cat_name or "groceries" in cat_name):
                return {"category_id": cat["id"], "category_name": cat["name"], "confidence": 0.88}
            if matched_type == "transportasi" and ("transport" in cat_name or "kendaraan" in cat_name):
                return {"category_id": cat["id"], "category_name": cat["name"], "confidence": 0.92}
            if matched_type == "tagihan" and ("tagihan" in cat_name or "utilitas" in cat_name or "listrik" in cat_name):
                return {"category_id": cat["id"], "category_name": cat["name"], "confidence": 0.95}
            if matched_type == "investasi" and ("invest" in cat_name or "saham" in cat_name):
                return {"category_id": cat["id"], "category_name": cat["name"], "confidence": 0.91}
            if matched_type == "hiburan" and ("hiburan" in cat_name or "rekreasi" in cat_name or "leisure" in cat_name):
                return {"category_id": cat["id"], "category_name": cat["name"], "confidence": 0.85}

    # Fallback to first category or empty
    if available_categories:
        return {"category_id": available_categories[0]["id"], "category_name": available_categories[0]["name"], "confidence": 0.50}
    return {"category_id": "", "category_name": "", "confidence": 0.0}


# 3. Advisor Chat Service — Indonesian Agentic Action Parser
VALID_AGENTIC_ACTION_TYPES = {
    "create_transaction",
    "create_transfer",
    "set_budget",
    "create_goal",
}

_SPOKEN_UNITS = {
    "nol": 0,
    "satu": 1,
    "se": 1,
    "dua": 2,
    "tiga": 3,
    "empat": 4,
    "lima": 5,
    "enam": 6,
    "tujuh": 7,
    "delapan": 8,
    "sembilan": 9,
}


def parse_indonesian_amount(text: str) -> float:
    """
    Parses Indonesian spoken or shorthand monetary amounts:
    e.g. '28rb', '1,5jt', '50k', '2x 10rb', 'goceng', 'ceban', 'Rp 150.000', 'seratus ribu', 'setengah juta'.
    """
    if not text:
        return 0.0
    low = text.lower()

    # 0. Explicit multiplication: "2x 10rb", "2x kopi 10rb", "3 x 6rb", "2 * Rp 15.000"
    m_qty = re.search(
        r"\b(\d{1,2})\s*(?:x|×|\*)\s*(?:(?:(?!\b(?:dan|atau|serta|pakai|pake|via|dr|dari|ke|lalu)\b)[a-z]+\s+){0,3})(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(jt|juta|rb|ribu|k)?\b",
        low,
    )
    if m_qty:
        qty = int(m_qty.group(1))
        raw_base = m_qty.group(2).replace(",", ".")
        if re.match(r"^\d{1,3}(?:\.\d{3})+$", m_qty.group(2)):
            raw_base = m_qty.group(2).replace(".", "")
        unit_q = m_qty.group(3) or ""
        try:
            base_q = float(raw_base)
        except ValueError:
            base_q = 0.0
        mult_q = 1_000_000.0 if unit_q in ("jt", "juta") else (1_000.0 if unit_q in ("rb", "ribu", "k") else 1.0)
        total_q = round(qty * base_q * mult_q)
        if total_q >= 100:
            return float(total_q)

    # 1. Explicit half-unit idioms
    if "setengah juta" in low:
        return 500_000.0
    if "setengah miliar" in low or "setengah milyar" in low:
        return 500_000_000.0

    # 2. Numeric shorthand with multiplier: 1,5jt / 28rb / 50k / 2.5 juta
    m_mult = re.search(
        r"(?:rp\.?\s*)?(\d+(?:[.,]\d+)?)\s*(jt|juta|m|miliar|milyar|rb|ribu|k)\b",
        low,
    )
    if m_mult:
        num_str = m_mult.group(1)
        unit = m_mult.group(2)
        if "," in num_str and "." not in num_str:
            num_str = num_str.replace(",", ".")
        elif "." in num_str and "," in num_str:
            num_str = num_str.replace(".", "").replace(",", ".")
        try:
            base = float(num_str)
        except ValueError:
            base = 0.0
        mult = 1.0
        if unit in ("jt", "juta"):
            mult = 1_000_000.0
        elif unit in ("rb", "ribu", "k"):
            mult = 1_000.0
        elif unit in ("m", "miliar", "milyar"):
            mult = 1_000_000_000.0
        first_val = round(base * mult)
        if unit in ("jt", "juta"):
            rem = low[m_mult.end():]
            m_extra = re.match(r"^\s*(?:lebih\s+)?(\d+(?:[.,]\d+)?)\s*(ribu|rb|k)\b", rem)
            if m_extra:
                extra = float(m_extra.group(1).replace(",", ".")) * 1_000.0
                return float(round(first_val + extra))
        return float(first_val)

    # 3. Standard formatted rupiah / digits: Rp 150.000 / 75000
    m_std = re.search(r"(?:rp\.?\s*)(\d[\d.,]*)|(\b\d{1,3}(?:\.\d{3})+\b|\b\d{4,}\b)", low)
    if m_std:
        raw = (m_std.group(1) or m_std.group(2) or "").strip()
        if "," in raw and "." in raw:
            raw = raw.replace(".", "").replace(",", ".")
        elif "." in raw:
            parts = raw.split(".")
            if all(len(p) == 3 for p in parts[1:]):
                raw = raw.replace(".", "")
        elif "," in raw:
            parts = raw.split(",")
            if len(parts[-1]) == 2:
                raw = raw.replace(",", ".")
            else:
                raw = raw.replace(",", "")
        try:
            return round(float(raw))
        except ValueError:
            pass

    # 4. Spoken Indonesian words: 'dua juta lima ratus ribu', 'seratus ribu', 'lima puluh ribu'
    if re.search(r"\b(ribu|juta|ratus|puluh|seribu|sejuta|seratus)\b", low):
        tokens = re.findall(r"[a-z]+", low)
        total = 0
        current = 0
        pending = 0
        matched_word_number = False
        for tok in tokens:
            if tok == "seribu":
                total += (current + pending) + 1000
                current = 0
                pending = 0
                matched_word_number = True
            elif tok == "sejuta":
                total += (current + pending) + 1_000_000
                current = 0
                pending = 0
                matched_word_number = True
            elif tok == "seratus":
                current += pending + 100
                pending = 0
                matched_word_number = True
            elif tok == "sepuluh":
                current += pending + 10
                pending = 0
                matched_word_number = True
            elif tok == "sebelas":
                current += pending + 11
                pending = 0
                matched_word_number = True
            elif tok in _SPOKEN_UNITS:
                current += pending
                pending = _SPOKEN_UNITS[tok]
                matched_word_number = True
            elif tok == "belas":
                current += (pending if pending > 0 else 1) + 10
                pending = 0
                matched_word_number = True
            elif tok == "puluh":
                current += (pending if pending > 0 else 1) * 10
                pending = 0
                matched_word_number = True
            elif tok == "ratus":
                current += (pending if pending > 0 else 1) * 100
                pending = 0
                matched_word_number = True
            elif tok == "ribu":
                chunk = current + pending
                total += (chunk if chunk > 0 else 1) * 1000
                current = 0
                pending = 0
                matched_word_number = True
            elif tok == "juta":
                chunk = current + pending
                total += (chunk if chunk > 0 else 1) * 1_000_000
                current = 0
                pending = 0
                matched_word_number = True
        if matched_word_number and (total + current + pending) > 0:
            return float(total + current + pending)

    # 5. Indonesian colloquial shorthand slang
    if re.search(r"\bcepek\s*(?:rb|ribu|k)\b", low):
        return 100_000.0
    if re.search(r"\bgocap\b", low):
        return 50_000.0
    if re.search(r"\bnoban\b", low):
        return 20_000.0
    if re.search(r"\bceban\b", low):
        return 10_000.0
    if re.search(r"\bgoceng\b", low):
        return 5_000.0
    if re.search(r"\bseceng\b", low):
        return 1_000.0

    return 0.0


def _resolve_account_from_text(
    text_lower: str,
    accounts: List[Dict[str, Any]],
    fallback_first: bool = True,
) -> Optional[Dict[str, Any]]:
    active = [a for a in accounts if a.get("is_active", True)]
    pool = active or accounts
    if not pool:
        return None
    best: Optional[Dict[str, Any]] = None
    best_len = 0
    for acc in pool:
        candidates = [
            str(acc.get("name") or "").lower().strip(),
            str(acc.get("bank_provider") or "").lower().strip(),
        ]
        for cand in candidates:
            if cand and cand in text_lower and len(cand) > best_len:
                best = acc
                best_len = len(cand)
    return best or (pool[0] if fallback_first else None)


def _resolve_category_from_text(
    text_lower: str,
    categories: List[Dict[str, Any]],
    tx_type: str,
) -> Optional[Dict[str, Any]]:
    typed = [c for c in categories if not c.get("type") or c.get("type") == tx_type]
    pool = typed or categories
    if not pool:
        return None
    for cat in pool:
        cname = str(cat.get("name") or "").lower().strip()
        if cname and cname in text_lower:
            return cat

    keyword_buckets = {
        "makan": ["kopi", "ngopi", "susu", "teh", "jus", "warteg", "makan", "minum", "bakso", "nasi", "lauk", "gorengan", "ayam", "restoran", "cafe", "lunch", "dinner", "snack", "jajan"],
        "belanja": ["belanja", "indomaret", "alfamart", "superindo", "sabun", "sembako"],
        "transport": ["bensin", "gojek", "grab", "tol", "parkir", "mrt", "krl", "ojol"],
        "tagihan": ["listrik", "pln", "wifi", "internet", "pdam", "bpjs", "pulsa"],
        "gaji": ["gaji", "bonus", "thr", "upah", "honor"],
    }
    for bucket, kws in keyword_buckets.items():
        if any(kw in text_lower for kw in kws):
            for cat in pool:
                if bucket in str(cat.get("name") or "").lower():
                    return cat
    return pool[0]


_COMPOUND_MONEY_SPAN_RE = re.compile(
    r"(?:\b\d{1,2}\s*(?:x|×|\*)\s*(?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)?\b"
    r"|(?:(?:rp\.?|idr)\s*)?(?:"
    r"\d+(?:[.,]\d+)?\s*(?:miliar|milyar|juta|jt)\b(?:\s+(?:lebih\s+)?\d+(?:[.,]\d+)?\s*(?:ribu|rb|k)\b)?"
    r"|\d+(?:[.,]\d+)?\s*(?:ribu|rb|k)\b"
    r"|(?:rp\.?|idr)\s*\d[\d.]*(?:,\d{1,2})?\b"
    r"|\b\d{1,3}(?:\.\d{3})+\b|\b\d{4,10}\b)"
    r"|\b(?:seceng|goceng|ceban|noban|gocap|cepek\s*(?:rb|ribu|k))\b)",
    re.IGNORECASE,
)


def _split_subclauses_by_amount_pairs(clause: str) -> List[str]:
    trimmed = clause.strip()
    if not trimmed:
        return []
    matches = list(_COMPOUND_MONEY_SPAN_RE.finditer(trimmed))
    if len(matches) < 2:
        return [trimmed]

    segments: List[str] = []
    cursor = 0
    for idx, match in enumerate(matches):
        end = match.end()
        if idx == len(matches) - 1:
            rest = trimmed[cursor:].strip()
            if rest:
                segments.append(rest)
        else:
            between = trimmed[end : matches[idx + 1].start()]
            if re.search(r"[a-zA-Z]{2,}", between):
                piece = trimmed[cursor:end].strip()
                if piece:
                    segments.append(piece)
                cursor = end
    return segments if len(segments) >= 2 else [trimmed]


def _split_indonesian_transaction_clauses(text: str) -> List[str]:
    rough_parts = [
        p.strip()
        for p in re.split(
            r"(?:,?\s+(?:dan|serta|lalu|terus|sama|kemudian|plus)\s+|,(?!\d)|[;\n•]+|\s+[+&]\s+)",
            text,
            flags=re.IGNORECASE,
        )
        if p and p.strip()
    ]
    clauses: List[str] = []
    for part in rough_parts:
        clauses.extend(_split_subclauses_by_amount_pairs(part))
    return clauses


def extract_indonesian_relative_date(text: str) -> str:
    low = (text or "").lower()
    now = datetime.now()
    m_ago = re.search(r"\b(\d{1,3})\s+hari\s+(?:(?:yang|yg)\s+)?lalu\b", low)
    if m_ago:
        offset = int(m_ago.group(1))
        if 1 <= offset <= 365:
            return (now - timedelta(days=offset)).strftime("%Y-%m-%d")
    if re.search(r"\b(?:se)?(?:minggu|pekan)\s+(?:(?:yang|yg)\s+)?lalu\b", low):
        return (now - timedelta(days=7)).strftime("%Y-%m-%d")
    if re.search(r"\bkemarin\s+lusa\b", low):
        return (now - timedelta(days=2)).strftime("%Y-%m-%d")
    if re.search(r"\bkemarin\b", low):
        return (now - timedelta(days=1)).strftime("%Y-%m-%d")
    if re.search(r"\blusa\b", low):
        return (now + timedelta(days=2)).strftime("%Y-%m-%d")
    if re.search(r"\bbesok\b", low):
        return (now + timedelta(days=1)).strftime("%Y-%m-%d")
    m_tgl = re.search(r"\b(?:tanggal|tgl)\s+(\d{1,2})\b", low)
    if m_tgl:
        day = int(m_tgl.group(1))
        next_m = (now.replace(day=28) + timedelta(days=4)).replace(day=1)
        max_day = (next_m - timedelta(days=1)).day
        if 1 <= day <= max_day:
            return f"{now.year:04d}-{now.month:02d}-{day:02d}"
    return now.strftime("%Y-%m-%d")


def _clean_indonesian_tx_description(clause: str, is_income: bool) -> str:
    desc = clause
    desc = re.sub(
        r"\b\d{1,2}\s*(?:x|×|\*)\s*(?:rp\.?\s*)?\d+(?:[.,]\d+)?\s*(?:juta|jt|ribu|rb|k)?\b",
        " ",
        desc,
        flags=re.IGNORECASE,
    )
    desc = re.sub(r"(?:rp\.?|idr)\s*\d[\d.]*(?:,\d{1,2})?\b", " ", desc, flags=re.IGNORECASE)
    desc = re.sub(r"\b\d+(?:[.,]\d+)?\s*(?:miliar|milyar|juta|jt|ribu|rb|k)\b", " ", desc, flags=re.IGNORECASE)
    desc = re.sub(r"\b(?:seceng|goceng|ceban|noban|gocap|cepek\s*(?:rb|ribu|k)?)\b", " ", desc, flags=re.IGNORECASE)
    desc = re.sub(
        r"\b(?:setengah\s+juta|sejuta|seratus|seribu|(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas)\s+(?:puluh\s+|ratus\s+)?(?:ribu|juta))\b",
        " ",
        desc,
        flags=re.IGNORECASE,
    )
    desc = re.sub(r"\b\d{1,3}(?:\.\d{3})+\b|\b\d{4,}\b", " ", desc)
    desc = re.sub(r"\b\d{1,3}\s+hari\s+(?:(?:yang|yg)\s+)?lalu\b", " ", desc, flags=re.IGNORECASE)
    desc = re.sub(
        r"\b(?:(?:se)?(?:minggu|pekan)\s+(?:(?:yang|yg)\s+)?lalu|kemarin\s+lusa|kemarin|lusa|besok|hari\s+ini|tadi\s+(?:pagi|siang|sore|malam)|(?:tanggal|tgl)\s+\d{1,2})\b",
        " ",
        desc,
        flags=re.IGNORECASE,
    )
    desc = re.sub(
        r"^(?:dan|serta|lalu|terus|sama|kemudian|plus)\b\s*",
        "",
        desc,
        flags=re.IGNORECASE,
    )
    desc = re.sub(
        r"\b(?:tolong|coba|catat|catatkan|beli|bayar|jajan|cicil|patungan|sedekah|infaq|zakat|pakai|pake|dr|via|dengan|dari|ke|masuk|untuk|sebesar|seharga|harga|senilai|nominal)\b",
        " ",
        desc,
        flags=re.IGNORECASE,
    )
    desc = re.sub(r"\s+", " ", desc).strip(" :-.,")
    return desc.capitalize() if desc else ("Pemasukan" if is_income else "Pengeluaran Harian")


def parse_indonesian_action_commands(
    message: str,
    accounts: Optional[List[Dict[str, Any]]] = None,
    categories: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Parses natural Indonesian financial commands (including multi-item lists such as
    'beli kopi 10rb, susu 6rb dan warteg 5rb') into one or more executable AgenticAction schemas
    matching frontend AdvisorChatDrawer actions.
    """
    clean = (message or "").strip()
    if not clean:
        return []
    low = clean.lower()
    accounts = accounts or []
    categories = categories or []
    amount = parse_indonesian_amount(clean)
    if amount <= 0:
        return []

    today = extract_indonesian_relative_date(clean)
    month = today[:7]

    # 1. Transfer intent: "transfer 500rb dari BCA ke GoPay", "topup gopay 200rb dr bca", "tarik tunai 300rb dr BCA"
    if re.search(r"\b(transfer|tf|kirim|pindah(?:in|kan)?(?:\s+dana)?|top\s?up|isi\s+saldo|tarik\s+tunai)\b", low):
        m_pair = re.search(r"\b(?:dari|dr|from)\s+([a-z0-9\s]+?)\s+(?:ke|to)\s+([a-z0-9\s]+)$", low)
        if len(accounts) >= 2:
            src: Optional[Dict[str, Any]] = None
            tgt: Optional[Dict[str, Any]] = None
            if m_pair:
                src = _resolve_account_from_text(m_pair.group(1), accounts, fallback_first=False)
                remaining = [a for a in accounts if not src or a.get("id") != src.get("id")]
                tgt = _resolve_account_from_text(m_pair.group(2), remaining, fallback_first=False)
            else:
                m_dari = re.search(r"\b(?:dari|dr)\s+([a-z0-9\s]+)", low)
                m_ke = re.search(r"\bke\s+([a-z0-9\s]+)", low)
                src = _resolve_account_from_text(m_dari.group(1), accounts, fallback_first=False) if m_dari else None
                rem_tgt = [a for a in accounts if not src or a.get("id") != src.get("id")]
                if m_ke:
                    tgt = _resolve_account_from_text(m_ke.group(1), rem_tgt, fallback_first=False)
                if not tgt and re.search(r"\b(top\s?up|isi\s+saldo|transfer|tf|kirim)\b", low):
                    tgt = _resolve_account_from_text(low, rem_tgt, fallback_first=False)
                if not tgt and re.search(r"\btarik\s+tunai\b", low):
                    tgt = next(
                        (a for a in rem_tgt if re.search(r"tunai|cash|dompet|kas", f"{a.get('name', '')} {a.get('type', '')}", re.IGNORECASE)),
                        None,
                    )
                if not src and tgt:
                    src = next((a for a in accounts if a.get("id") != tgt.get("id")), None)
            if src and tgt and src.get("id") != tgt.get("id"):
                return [
                    {
                        "id": f"act-{uuid.uuid4().hex[:8]}",
                        "type": "create_transfer",
                        "title": f"Transfer {src.get('name')} → {tgt.get('name')}",
                        "summary": f"Nominal Rp {amount:,.0f}".replace(",", ".") + f" pada {today}",
                        "payload": {
                            "source_account_id": src["id"],
                            "target_account_id": tgt["id"],
                            "amount": amount,
                            "date": today,
                            "notes": "Transfer via AI Advisor",
                        },
                    }
                ]

    # 2. Set budget intent: "atur budget makan 2jt"
    if re.search(r"\b(atur|set|buat)\s+(?:budget|anggaran)\b", low) or (
        re.search(r"\b(budget|anggaran)\b", low) and re.search(r"\b(bulan|per\s*bulan|/bln|jadi|menjadi)\b", low)
    ):
        cat = _resolve_category_from_text(low, categories, "expense")
        if cat:
            return [
                {
                    "id": f"act-{uuid.uuid4().hex[:8]}",
                    "type": "set_budget",
                    "title": f"Atur Anggaran {cat.get('name', 'Kategori')}",
                    "summary": f"Batas Rp {amount:,.0f}".replace(",", ".") + f" untuk bulan {month}",
                    "payload": {
                        "category_id": cat["id"],
                        "month": month,
                        "amount": amount,
                    },
                }
            ]

    # 3. Create goal intent: "buat target dana liburan 10jt"
    if re.search(r"\b(target|goal|tabungan\s+impian|impian)\b", low) and re.search(
        r"\b(buat|tambah|bikin|mulai|simpan)\b", low
    ):
        desc = re.sub(
            r"\b(tolong|coba|buat|buatkan|tambah|tambahkan|bikin|target|goal|impian|sebesar|senilai)\b",
            "",
            clean,
            flags=re.IGNORECASE,
        ).strip(" :-.,")
        title_desc = desc[:60] if desc else "Target Keuangan Baru"
        acc = _resolve_account_from_text(low, accounts)
        payload: Dict[str, Any] = {
            "name": title_desc,
            "type": "custom",
            "target_amount": amount,
        }
        if acc:
            payload["linked_account_id"] = acc["id"]
        return [
            {
                "id": f"act-{uuid.uuid4().hex[:8]}",
                "type": "create_goal",
                "title": f"Buat Target: {title_desc}",
                "summary": f"Target Rp {amount:,.0f}".replace(",", "."),
                "payload": payload,
            }
        ]

    # 4. Transaction intent (single or multi-item list with per-item polarity)
    has_tx_verb = bool(
        re.search(
            r"\b(catat|catatkan|rekam|beli|bayar|jajan|makan|ngopi|isi\s+bensin|belanja|cicil|sedekah|infaq|zakat|pengeluaran|keluar|terima|trima|gaji|pemasukan|masuk|dapat)\b",
            low,
        )
    )
    clauses_preview = _split_indonesian_transaction_clauses(clean)
    has_multi_item_amounts = sum(1 for c in clauses_preview if parse_indonesian_amount(c) > 0) >= 2
    is_hypothetical = bool(
        re.search(r"\b(simulasi|what[\s-]*if|andai|kalau|jika|kira[\s-]*kira|berapa|apakah|bagaimana|gimana)\b", low)
    ) or ("?" in clean and not has_tx_verb)
    if (has_tx_verb or has_multi_item_amounts) and not is_hypothetical:
        income_re = re.compile(r"\b(terima|trima|gaji|salary|pemasukan|masuk|dapat|bonus|thr|freelance|komisi|honor|dividen|refund)\b", re.IGNORECASE)
        expense_cue_re = re.compile(r"\b(beli|bayar|keluar|pengeluaran|jajan|makan|minum|kopi|susu|warteg|bensin|parkir|belanja|listrik|air|pdam|wifi|kos|kontrakan|cicil|cicilan|kredit|tagihan|pulsa|paket|obat|sedekah|zakat|infaq|patungan)\b", re.IGNORECASE)
        global_is_income = bool(income_re.search(low))
        shared_acc = _resolve_account_from_text(low, accounts)
        if not shared_acc:
            return []

        clauses = clauses_preview
        if len(clauses) >= 2:
            multi_actions: List[Dict[str, Any]] = []
            for clause in clauses:
                c_amt = parse_indonesian_amount(clause)
                if c_amt <= 0:
                    continue
                c_low = clause.lower()
                c_is_income = bool(income_re.search(c_low)) and not bool(expense_cue_re.search(c_low))
                c_type = "income" if c_is_income else "expense"
                c_acc = _resolve_account_from_text(c_low, accounts, fallback_first=False) or shared_acc
                c_cat = _resolve_category_from_text(c_low, categories, c_type)
                c_desc = _clean_indonesian_tx_description(clause, c_is_income)
                # Strip explicitly matched account name tokens when user writes "warteg 5rb pakai BCA"
                acc_name_raw = str(c_acc.get("name") or "").strip()
                prov_raw = str(c_acc.get("bank_provider") or "").strip()
                for token in (acc_name_raw, prov_raw):
                    if token and len(token) >= 2:
                        c_desc = re.sub(rf"\b{re.escape(token)}\b", " ", c_desc, flags=re.IGNORECASE).strip()
                c_desc = re.sub(r"\s+", " ", c_desc).strip(" :-.,") or (
                    "Pemasukan" if c_is_income else "Pengeluaran Harian"
                )
                c_desc = c_desc[0].upper() + c_desc[1:]

                c_payload: Dict[str, Any] = {
                    "date": today,
                    "amount": c_amt,
                    "type": c_type,
                    "account_id": c_acc["id"],
                    "description": c_desc,
                }
                if c_cat:
                    c_payload["category_id"] = c_cat["id"]
                acc_name = c_acc.get("name", "Rekening")
                cat_name = c_cat.get("name", "Umum") if c_cat else "Umum"
                multi_actions.append(
                    {
                        "id": f"act-{uuid.uuid4().hex[:8]}",
                        "type": "create_transaction",
                        "title": f"Catat {'Pemasukan' if c_is_income else 'Pengeluaran'}: {c_desc}",
                        "summary": f"Rp {c_amt:,.0f}".replace(",", ".") + f" • {acc_name} • {cat_name}",
                        "payload": c_payload,
                    }
                )
            if len(multi_actions) >= 2:
                return multi_actions

        tx_type = "income" if global_is_income else "expense"
        acc = shared_acc
        cat = _resolve_category_from_text(low, categories, tx_type)
        desc = _clean_indonesian_tx_description(clean, global_is_income)
        payload = {
            "date": today,
            "amount": amount,
            "type": tx_type,
            "account_id": acc["id"],
            "description": desc,
        }
        if cat:
            payload["category_id"] = cat["id"]
        acc_name = acc.get("name", "Rekening")
        cat_name = cat.get("name", "Umum") if cat else "Umum"
        return [
            {
                "id": f"act-{uuid.uuid4().hex[:8]}",
                "type": "create_transaction",
                "title": f"Catat {'Pemasukan' if global_is_income else 'Pengeluaran'}: {desc}",
                "summary": f"Rp {amount:,.0f}".replace(",", ".") + f" • {acc_name} • {cat_name}",
                "payload": payload,
            }
        ]

    return []


def parse_indonesian_action_command(
    message: str,
    accounts: Optional[List[Dict[str, Any]]] = None,
    categories: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """
    Backward-compatible single-action wrapper over `parse_indonesian_action_commands`.
    """
    commands = parse_indonesian_action_commands(message, accounts, categories)
    return commands[0] if commands else None


def _normalize_history_turns(history: Optional[List[Dict[str, str]]]) -> List[Dict[str, str]]:
    turns: List[Dict[str, str]] = []
    if not isinstance(history, list):
        return turns
    for item in history:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role") or "").strip().lower()
        content = str(item.get("content") or "").strip()
        if role in ("user", "assistant") and content:
            turns.append({"role": role, "content": content[:1500]})
    return turns[-10:]


def _resolve_followup_command(
    message: str, history: Optional[List[Dict[str, str]]]
) -> str:
    """
    Combines targeted follow-up refinements (e.g. 'yang kopi jadi 12rb', 'tambah teh 4rb',
    'hapus warteg', 'ubah jadi 45rb', 'pakai BCA') with the prior command.
    """
    clean = (message or "").strip()
    if not clean or not history:
        return clean
    low = clean.lower()
    if re.match(
        r"^(catat|catatkan|rekam|beli|bayar|makan|ngopi|isi|belanja|jajan|cicil|sedekah|infaq|zakat|terima|trima|dapat|gaji|bonus|thr|top\s?up|transfer|tf|kirim)\b",
        low,
    ):
        return clean
    is_followup = bool(
        re.search(
            r"^(ubah|ganti|revisi|koreksi|jadikan|jadi|pakai|pake|via|tambah|tambahin|hapus|hilangkan|tanpa|ga\s+jadi|gak\s+jadi|yang|utk|untuk|kemarin|besok|lusa)\b",
            low,
        )
        or (
            re.search(r"\b(ubah|ganti|revisi|koreksi|jadikan|tambah|hapus)\b", low)
            and len(clean.split()) <= 8
        )
        or (
            re.search(r"\b(pakai|pake|via)\b", low)
            and parse_indonesian_amount(clean) <= 0
            and len(clean.split()) <= 5
        )
    )
    if not is_followup or len(clean.split()) > 10:
        return clean

    turns = _normalize_history_turns(history)
    prev_user_msgs = [t["content"] for t in turns if t["role"] == "user"]
    if not prev_user_msgs:
        return clean
    prev_msg = prev_user_msgs[-1]
    if not (
        re.search(
            r"\b(catat|catatkan|beli|bayar|transfer|tf|top\s?up|kirim|budget|anggaran|target|goal|gaji|terima)\b",
            prev_msg.lower(),
        )
        or parse_indonesian_amount(prev_msg) > 0
    ):
        return clean

    # 1. Append item: "tambah teh 4rb"
    m_add = re.match(r"^(?:tolong\s+)?(?:tambah(?:kan|in)?)\s+(.+)$", clean, flags=re.IGNORECASE)
    if m_add and parse_indonesian_amount(m_add.group(1)) > 0:
        return f"{prev_msg}, {m_add.group(1).strip()}"

    # 2. Remove item: "hapus warteg" / "tanpa susu"
    m_rem = re.match(r"^(?:hapus|hilangkan|buang|tanpa|ga\s+jadi|gak\s+jadi)\s+(.+)$", clean, flags=re.IGNORECASE)
    if m_rem:
        target = m_rem.group(1).strip().lower()
        prev_clauses = _split_indonesian_transaction_clauses(prev_msg)
        if len(prev_clauses) >= 2:
            kept = [c for c in prev_clauses if target not in c.lower()]
            if 0 < len(kept) < len(prev_clauses):
                return ", ".join(kept)

    # 3. Targeted clause edit: "yang kopi jadi 12rb"
    m_tgt = re.match(
        r"^(?:yang\s+|untuk\s+)?(?:(?:ubah|ganti|revisi|koreksi)\s+)?(?:yang\s+)?([a-z0-9\s]{2,25}?)\s+(?:ubah\s+|ganti\s+)?(?:jadi|menjadi|ke|=)\s+(.+)$",
        clean,
        flags=re.IGNORECASE,
    )
    if m_tgt:
        item_hint = m_tgt.group(1).strip().lower()
        new_amt_tgt = parse_indonesian_amount(m_tgt.group(2))
        prev_clauses = _split_indonesian_transaction_clauses(prev_msg)
        if new_amt_tgt > 0 and item_hint and item_hint not in ("nya", "itu", "total", "semua") and len(prev_clauses) >= 2:
            replaced = False
            updated: List[str] = []
            for clause in prev_clauses:
                if item_hint in clause.lower():
                    replaced = True
                    stripped = _COMPOUND_MONEY_SPAN_RE.sub(" ", clause)
                    stripped = re.sub(r"\s+", " ", stripped).strip()
                    updated.append(f"{stripped} {int(new_amt_tgt)}")
                else:
                    updated.append(clause)
            if replaced:
                return ", ".join(updated)

    # 4. Single amount correction or account switch
    new_amt = parse_indonesian_amount(clean)
    if new_amt > 0 and len(_split_indonesian_transaction_clauses(prev_msg)) <= 1:
        stripped_prev = _COMPOUND_MONEY_SPAN_RE.sub("", prev_msg)
        stripped_prev = re.sub(r"\s+", " ", stripped_prev).strip()
        return f"{stripped_prev} {int(new_amt)}"
    if re.search(r"\b(pakai|pake|via|dari|dr)\b", low):
        stripped_prev = re.sub(r"\b(pakai|pake|via)\s+[a-z0-9\s]+$", "", prev_msg, flags=re.IGNORECASE).strip()
        return f"{stripped_prev} {clean}"
    return clean


async def chat_advisor(
    message: str,
    context_data: Dict[str, Any],
    provider: str,
    model_name: str,
    api_key: Optional[str],
    history: Optional[List[Dict[str, str]]] = None,
) -> Dict[str, Any]:
    """
    Chats with the AI Financial Advisor.
    Prefixes responses with a disclaimer, reasons using provided context, and
    emits executable `proposed_actions` when user commands a mutation.
    """
    # 1. Extract context sub-objects
    dashboard = context_data.get("dashboard", {}) or {}
    ef = context_data.get("emergency_fund", {}) or {}
    budget = context_data.get("budget", {}) or {}
    accounts = context_data.get("accounts", []) or []
    categories = context_data.get("categories", []) or []
    normalized_history = _normalize_history_turns(history)
    effective_message = _resolve_followup_command(message, normalized_history)
    deterministic_actions = parse_indonesian_action_commands(
        effective_message, accounts, categories
    )
    deterministic_action = deterministic_actions[0] if deterministic_actions else None
    fallback_actions = deterministic_actions
    today_iso = datetime.now().strftime("%Y-%m-%d")

    system_prompt = _build_advisor_system_prompt(context_data)

    if not api_key or provider == "local":
        logger.info("Using mock advisor response")
        return generate_mock_chat_response(
            effective_message,
            context_data,
            deterministic_action=deterministic_action,
            deterministic_actions=deterministic_actions,
        )

    try:
        headers = {
            "Authorization": f"Bearer {api_key}" if provider == "openai" else "",
            "x-api-key": api_key if provider == "anthropic" else "",
            "Content-Type": "application/json"
        }

        if provider == "openai":
            llm_model = model_name if model_name != "default" else "gpt-4o-mini"
            oai_messages = [{"role": "system", "content": system_prompt}]
            oai_messages.extend(normalized_history)
            oai_messages.append({"role": "user", "content": message})
            content = await call_openai_chat(
                api_key=api_key,
                model=llm_model,
                messages=oai_messages,
                temperature=0.3,
                max_tokens=1200,
                timeout=45.0,
            )
            return parse_advisor_response(content, fallback_actions=fallback_actions, context_data=context_data)
        elif provider == "anthropic":
            headers["anthropic-version"] = "2023-06-01"
            llm_model = model_name if model_name != "default" else "claude-3-5-sonnet-20241022"
            anth_messages = list(normalized_history) + [{"role": "user", "content": message}]
            payload = {
                "model": llm_model,
                "max_tokens": 1200,
                "system": system_prompt,
                "messages": anth_messages,
                "temperature": 0.3
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
                resp.raise_for_status()
                content = resp.json()["content"][0]["text"]
                return parse_advisor_response(content, fallback_actions=fallback_actions, context_data=context_data)
        elif provider == "gemini":
            llm_model = model_name if model_name != "default" else "gemini-2.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{llm_model}:generateContent?key={api_key}"
            gem_contents = [
                {
                    "role": "model" if t["role"] == "assistant" else "user",
                    "parts": [{"text": t["content"]}],
                }
                for t in normalized_history
            ]
            gem_contents.append({"role": "user", "parts": [{"text": message}]})
            payload = {
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": gem_contents,
                "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1200},
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                return parse_advisor_response(content, fallback_actions=fallback_actions, context_data=context_data)
    except Exception as e:
        logger.error(f"Error calling {provider} for advisor chat: {str(e)}")
        return generate_mock_chat_response(
            effective_message,
            context_data,
            deterministic_action=deterministic_action,
            deterministic_actions=deterministic_actions,
        )

    return generate_mock_chat_response(
        effective_message,
        context_data,
        deterministic_action=deterministic_action,
        deterministic_actions=deterministic_actions,
    )


async def _stream_raw_llm_tokens(
    *,
    provider: str,
    model_name: str,
    api_key: str,
    system_prompt: str,
    history: List[Dict[str, str]],
    message: str,
) -> AsyncGenerator[str, None]:
    """Yields incremental raw text tokens directly from OpenAI, Gemini, or Anthropic SSE streams."""
    if provider == "openai":
        llm_model = model_name if model_name != "default" else "gpt-4o-mini"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        messages = [{"role": "system", "content": system_prompt}, *history, {"role": "user", "content": message}]
        payload = {
            "model": llm_model,
            "messages": messages,
            "temperature": 0.3,
            "max_tokens": 1200,
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=45.0) as client:
            async with client.stream("POST", openai_chat_completions_url(), json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    trimmed = line.strip()
                    if not trimmed.startswith("data:"):
                        continue
                    data_str = trimmed[5:].strip()
                    if not data_str or data_str == "[DONE]":
                        continue
                    try:
                        evt = json.loads(data_str)
                        delta = (evt.get("choices") or [{}])[0].get("delta", {}).get("content") or ""
                        if delta:
                            yield delta
                    except Exception:
                        continue
        return

    if provider == "gemini":
        llm_model = model_name if model_name != "default" else "gemini-2.5-flash"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{llm_model}:streamGenerateContent?alt=sse&key={api_key}"
        gem_contents = [
            {"role": "model" if t["role"] == "assistant" else "user", "parts": [{"text": t["content"]}]}
            for t in history
        ]
        gem_contents.append({"role": "user", "parts": [{"text": message}]})
        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": gem_contents,
            "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1200},
        }
        async with httpx.AsyncClient(timeout=45.0) as client:
            async with client.stream("POST", url, json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    trimmed = line.strip()
                    if not trimmed.startswith("data:"):
                        continue
                    data_str = trimmed[5:].strip()
                    if not data_str or data_str == "[DONE]":
                        continue
                    try:
                        evt = json.loads(data_str)
                        parts = ((evt.get("candidates") or [{}])[0].get("content") or {}).get("parts") or []
                        for part in parts:
                            txt = part.get("text") or ""
                            if txt:
                                yield txt
                    except Exception:
                        continue
        return

    if provider == "anthropic":
        llm_model = model_name if model_name != "default" else "claude-3-5-sonnet-20241022"
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        payload = {
            "model": llm_model,
            "max_tokens": 1200,
            "system": system_prompt,
            "messages": [*history, {"role": "user", "content": message}],
            "temperature": 0.3,
            "stream": True,
        }
        async with httpx.AsyncClient(timeout=45.0) as client:
            async with client.stream("POST", "https://api.anthropic.com/v1/messages", json=payload, headers=headers) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    trimmed = line.strip()
                    if not trimmed.startswith("data:"):
                        continue
                    data_str = trimmed[5:].strip()
                    if not data_str:
                        continue
                    try:
                        evt = json.loads(data_str)
                        if evt.get("type") == "content_block_delta":
                            txt = (evt.get("delta") or {}).get("text") or ""
                            if txt:
                                yield txt
                    except Exception:
                        continue


def _build_advisor_system_prompt(context_data: Dict[str, Any]) -> str:
    today_iso = datetime.now().strftime("%Y-%m-%d")
    dashboard = context_data.get("dashboard", {}) or {}
    ef = context_data.get("emergency_fund", {}) or {}
    budget = context_data.get("budget", {}) or {}
    accounts = context_data.get("accounts", []) or []
    categories = context_data.get("categories", []) or []
    budget_cats = context_data.get("budget_categories", []) or []
    recent_tx = context_data.get("recent_transactions", []) or []
    debts = context_data.get("debts", []) or []
    goals = context_data.get("goals", []) or []

    def _v(obj, key: str, default: float = 0.0) -> float:
        raw = obj.get(key, default)
        if isinstance(raw, dict):
            for field in ("value", "total_outstanding", "total", "amount"):
                if field in raw and raw.get(field) is not None:
                    raw = raw.get(field)
                    break
            else:
                raw = default
        try:
            return float(raw)
        except (TypeError, ValueError):
            return default

    net_worth = _v(dashboard, "net_worth")
    cash = _v(dashboard, "cash_available")
    safe_spend = _v(dashboard, "safe_to_spend")
    debts_total = _v(dashboard, "total_debts")
    dti_val = dashboard.get("dti_ratio", 0)
    score_obj = dashboard.get("health_score", {})
    score_num = score_obj.get("score", 0) if isinstance(score_obj, dict) else score_obj
    score_lbl = (score_obj.get("rating") or score_obj.get("status") or "N/A") if isinstance(score_obj, dict) else "N/A"
    forecast_val = _v(dashboard, "forecast_end_month")
    ef_cur = _v(ef, "total_emergency_fund")
    ef_tgt = _v(ef, "target_amount")
    ef_m = ef.get("coverage_months", 0)
    b_lim = _v(budget, "total_budget")
    b_spn = _v(budget, "total_spent")
    b_rem = _v(budget, "remaining")
    b_rem_pct = (b_rem / b_lim * 100) if b_lim > 0 else 100.0

    acc_summary = ", ".join(
        f"{a.get('name')} (id={a.get('id')}, type={a.get('type', 'bank')}"
        + (f", saldo=Rp {float(a['balance']):,.0f}" if a.get("balance") is not None else "")
        + ")"
        for a in accounts[:12]
        if a.get("id")
    ) or "Belum ada"
    cat_summary = ", ".join(
        f"{c.get('name')} (id={c.get('id')}, type={c.get('type', 'expense')})"
        for c in categories[:20]
        if c.get("id")
    ) or "Belum ada"
    bills_summary = "; ".join(
        f"{b.get('name')} Rp {float(b.get('amount') or 0):,.0f} ({b.get('days_remaining', '?')} hari lagi)"
        for b in (dashboard.get("upcoming_bills") or [])[:6]
    ) or "Tidak ada"
    budget_cat_summary = "; ".join(
        f"{b.get('category_name')}: terpakai Rp {float(b.get('spent') or 0):,.0f}/{float(b.get('limit') or 0):,.0f} ({float(b.get('used_percentage') or 0):.0f}%)"
        for b in budget_cats[:8]
    ) or "Belum diatur"
    debts_summary = "; ".join(
        f"{d.get('name')}: sisa Rp {float(d.get('outstanding_balance') or 0):,.0f}"
        + (f" bunga {d.get('interest_rate')}%" if d.get("interest_rate") is not None else "")
        for d in debts[:8]
    ) or "Tidak ada"
    goals_summary = "; ".join(
        f"{g.get('name')}: Rp {float(g.get('current_amount') or 0):,.0f}/{float(g.get('target_amount') or 0):,.0f} ({float(g.get('progress') or 0):.0f}%)"
        for g in goals[:6]
    ) or "Belum ada"
    tx_summary = "; ".join(
        f"{t.get('date', '')} {t.get('type', '')} Rp {float(t.get('amount') or 0):,.0f} '{t.get('description') or t.get('category_name') or '-'}'"
        for t in recent_tx[:10]
    ) or "Belum ada"

    spending_analytics = context_data.get("spending_analytics") or {}
    sa_cur = float(spending_analytics.get("current_month_expense") or 0)
    sa_prev = float(spending_analytics.get("prev_month_expense") or 0)
    sa_burn = float(spending_analytics.get("daily_burn_rate") or 0)
    sa_rem_days = int(spending_analytics.get("remaining_days_in_month") or 1)
    sa_quota = round(max(0.0, safe_spend) / max(1, sa_rem_days))
    analytics_line = ""
    if sa_cur > 0 or sa_prev > 0:
        analytics_line = (
            f"Belanja Bulan Ini: Rp {sa_cur:,.0f} (rata-rata Rp {sa_burn:,.0f}/hari) vs Bulan Lalu Rp {sa_prev:,.0f} • "
            f"Sisa {sa_rem_days} hari (kuota harian ~Rp {sa_quota:,.0f}/hari)\n"
        )

    ctx_str = (
        f"Tanggal Hari Ini: {today_iso}\n"
        f"Kekayaan Bersih: Rp {net_worth:,.2f}\n"
        f"Kas Tersedia: Rp {cash:,.2f} (Safe-to-Spend: Rp {safe_spend:,.2f})\n"
        f"{analytics_line}"
        f"Total Utang: Rp {debts_total:,.2f} (Rincian: {debts_summary})\n"
        f"Rasio DTI: {dti_val}% ({dashboard.get('dti_status', 'N/A')})\n"
        f"Skor Kesehatan Keuangan: {score_num}/100 ({score_lbl})\n"
        f"Prediksi Akhir Bulan: Rp {forecast_val:,.2f}\n"
        f"Status Dana Darurat: Target Rp {ef_tgt:,.2f}, Terkumpul Rp {ef_cur:,.2f} ({ef_m} bulan tercover)\n"
        f"Status Anggaran Bulan Ini: Limit Rp {b_lim:,.2f}, Terpakai Rp {b_spn:,.2f} ({b_rem_pct:.1f}% tersisa)\n"
        f"Rincian Anggaran per Kategori: {budget_cat_summary}\n"
        f"Tagihan Jatuh Tempo Dekat: {bills_summary}\n"
        f"Target Tabungan: {goals_summary}\n"
        f"Transaksi Terbaru: {tx_summary}\n"
        f"Daftar Rekening Aktif: {acc_summary}\n"
        f"Daftar Kategori: {cat_summary}\n"
    )
    return (
        "Anda adalah asisten perencana keuangan pribadi profesional (AI Advisor) untuk keluarga Indonesia. "
        "Jawab pertanyaan user dalam Bahasa Indonesia yang ringkas, akurat, solutif, dan berbasis angka nyata dari data di bawah ini.\n\n"
        f"Konteks Finansial User:\n{ctx_str}\n\n"
        "PENTING:\n"
        "1. JAWABAN ANDA HARUS SELALU diawali dengan baris disclaimer tepat seperti ini:\n"
        "🤖 Saran AI — bukan nasihat keuangan profesional\n\n"
        "2. Jika user meminta mencatat transaksi, transfer antar rekening, mengatur budget, atau membuat target keuangan, "
        "Anda WAJIB menyertakan blok ```actions JSON array menggunakan HANYA ID rekening/kategori yang valid di atas:\n"
        "- ATURAN MULTI-ITEM: Jika user menyebut beberapa pembelian/item dalam satu pesan "
        "(contoh: 'beli kopi 10rb, susu 6rb dan warteg 5rb'), Anda WAJIB memecahnya menjadi beberapa objek terpisah di dalam array ```actions "
        "(satu objek `create_transaction` per item dengan nominal masing-masing: 10000, 6000, 5000). JANGAN gabung menjadi satu transaksi dan JANGAN hanya ambil item terakhir.\n"
        "- Skema payload per type:\n"
        "  - create_transaction: {\"date\": \"" + today_iso + "\", \"amount\": 10000, \"type\": \"expense|income\", \"account_id\": \"<id rekening>\", \"category_id\": \"<id kategori>\", \"description\": \"Kopi\"}\n"
        "  - create_transfer: {\"source_account_id\": \"<id asal>\", \"target_account_id\": \"<id tujuan>\", \"amount\": 500000, \"date\": \"" + today_iso + "\", \"notes\": \"Transfer via AI Advisor\"}\n"
        "  - set_budget: {\"category_id\": \"<id kategori>\", \"month\": \"" + today_iso[:7] + "\", \"amount\": 2000000}\n"
        "  - create_goal: {\"name\": \"Nama Target\", \"type\": \"custom\", \"target_amount\": 10000000}\n"
        "```actions\n"
        "[{\"id\": \"act-1\", \"type\": \"create_transaction\", \"title\": \"Catat Pengeluaran: Kopi\", \"summary\": \"Rp 10.000 • BCA • Makan\", \"payload\": {\"date\": \"" + today_iso + "\", \"amount\": 10000, \"type\": \"expense\", \"account_id\": \"<id>\", \"category_id\": \"<id>\", \"description\": \"Kopi\"}}]\n"
        "```\n"
        "3. Di bagian akhir jawaban Anda, Anda HARUS menulis bagian 'Alasan:' yang merangkum alasan di balik rekomendasi Anda berdasarkan data finansial di atas.\n"
        "Format output akhir:\n"
        "🤖 Saran AI — bukan nasihat keuangan profesional\n"
        "[Isi saran detail Anda dengan angka dan rekomendasi konkret]\n\n"
        "Alasan: [Alasan ringkas Anda]"
    )


async def stream_chat_advisor(
    message: str,
    context_data: Dict[str, Any],
    provider: str,
    model_name: str,
    api_key: Optional[str],
    history: Optional[List[Dict[str, str]]] = None,
) -> AsyncGenerator[str, None]:
    """
    Streams advisor chat responses as Server-Sent Events (SSE):
      1. Initial `meta` frame with fast deterministic `proposed_actions`
      2. Live token `delta` frames directly from LLM (or instant chunked reply in local/action mode)
      3. Updated `meta` (if LLM emitted extra actions/reason) and final `done` frame
    """
    accounts = context_data.get("accounts", []) or []
    categories = context_data.get("categories", []) or []
    normalized_history = _normalize_history_turns(history)
    effective_message = _resolve_followup_command(message, normalized_history)
    deterministic_actions = parse_indonesian_action_commands(
        effective_message, accounts, categories
    )

    if not api_key or provider == "local" or deterministic_actions:
        result = await chat_advisor(
            message=message,
            context_data=context_data,
            provider=provider,
            model_name=model_name,
            api_key=api_key,
            history=history,
        )
        meta_event: Dict[str, Any] = {
            "type": "meta",
            "reason": result.get("reason", ""),
            "proposed_actions": result.get("proposed_actions") or [],
        }
        if result.get("suggested_replies"):
            meta_event["suggested_replies"] = result["suggested_replies"]
        yield f"data: {json.dumps(meta_event, ensure_ascii=False)}\n\n"

        full_text = str(result.get("response") or "")
        words = full_text.split(" ")
        chunk_size = 5
        for idx in range(0, len(words), chunk_size):
            piece = " ".join(words[idx : idx + chunk_size])
            if idx + chunk_size < len(words):
                piece += " "
            yield f"data: {json.dumps({'type': 'delta', 'content': piece}, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0)

        yield f"data: {json.dumps({'type': 'done'})}\n\n"
        return

    # Real-time LLM SSE streaming for OpenAI / Gemini / Anthropic
    yield f"data: {json.dumps({'type': 'meta', 'reason': 'Menyusun saran dari data keuangan Anda...', 'proposed_actions': []}, ensure_ascii=False)}\n\n"
    disclaimer = "🤖 Saran AI — bukan nasihat keuangan profesional"
    sys_prompt = _build_advisor_system_prompt(context_data)
    raw_buffer = ""
    emitted_len = 0
    stop_delta = False

    try:
        async for token in _stream_raw_llm_tokens(
            provider=provider,
            model_name=model_name,
            api_key=api_key,
            system_prompt=sys_prompt,
            history=normalized_history,
            message=message,
        ):
            raw_buffer += token
            if not stop_delta:
                body = raw_buffer.replace(disclaimer, "").lstrip()
                cut_points = [i for i in (body.find("```actions"), body.find("Alasan:")) if i >= 0]
                if cut_points:
                    cut = min(cut_points)
                    if cut > emitted_len:
                        piece = body[emitted_len:cut].rstrip()
                        if piece:
                            yield f"data: {json.dumps({'type': 'delta', 'content': piece}, ensure_ascii=False)}\n\n"
                        emitted_len = cut
                    stop_delta = True
                elif len(body) > emitted_len + 12:
                    # Keep short lookahead tail to prevent half-markers ("```act" / "Alasa") from flashing
                    safe_end = len(body) - 12
                    piece = body[emitted_len:safe_end]
                    if piece:
                        yield f"data: {json.dumps({'type': 'delta', 'content': piece}, ensure_ascii=False)}\n\n"
                    emitted_len = safe_end

        if raw_buffer.strip():
            parsed = parse_advisor_response(
                raw_buffer,
                fallback_actions=deterministic_actions,
                context_data=context_data,
            )
            final_text = str(parsed.get("response") or "")
            if not stop_delta and len(final_text) > emitted_len:
                tail = final_text[emitted_len:]
                if tail:
                    yield f"data: {json.dumps({'type': 'delta', 'content': tail}, ensure_ascii=False)}\n\n"
            end_meta: Dict[str, Any] = {
                "type": "meta",
                "reason": parsed.get("reason", ""),
                "proposed_actions": parsed.get("proposed_actions") or [],
            }
            if parsed.get("suggested_replies"):
                end_meta["suggested_replies"] = parsed["suggested_replies"]
            yield f"data: {json.dumps(end_meta, ensure_ascii=False)}\n\n"
            yield f"data: {json.dumps({'type': 'done'})}\n\n"
            return
    except Exception as exc:
        logger.warning("Streaming LLM fallback triggered (%s): %s", provider, exc)

    # Graceful fallback to non-streaming completion / local brain
    result = await chat_advisor(
        message=message,
        context_data=context_data,
        provider=provider,
        model_name=model_name,
        api_key=api_key,
        history=history,
    )
    fb_meta: Dict[str, Any] = {
        "type": "meta",
        "reason": result.get("reason", ""),
        "proposed_actions": result.get("proposed_actions") or [],
    }
    if result.get("suggested_replies"):
        fb_meta["suggested_replies"] = result["suggested_replies"]
    yield f"data: {json.dumps(fb_meta, ensure_ascii=False)}\n\n"
    full_text = str(result.get("response") or "")
    if full_text:
        yield f"data: {json.dumps({'type': 'delta', 'content': full_text}, ensure_ascii=False)}\n\n"
    yield f"data: {json.dumps({'type': 'done'})}\n\n"


def _extract_actions_block(content: str) -> Tuple[str, List[Dict[str, Any]]]:
    actions: List[Dict[str, Any]] = []
    match = re.search(r"```actions\s*([\s\S]*?)```", content, re.IGNORECASE)
    cleaned = content
    if match:
        raw_block = match.group(1).strip()
        cleaned = (content[: match.start()] + content[match.end() :]).strip()
        try:
            parsed = json.loads(raw_block)
            if isinstance(parsed, dict):
                parsed = [parsed]
            if isinstance(parsed, list):
                for idx, item in enumerate(parsed):
                    if not isinstance(item, dict):
                        continue
                    act_type = str(item.get("type") or "").strip()
                    if act_type not in VALID_AGENTIC_ACTION_TYPES:
                        continue
                    payload = item.get("payload")
                    if not isinstance(payload, dict):
                        continue
                    actions.append(
                        {
                            "id": str(item.get("id") or f"act-llm-{idx + 1}"),
                            "type": act_type,
                            "title": str(item.get("title") or act_type),
                            "summary": str(item.get("summary") or ""),
                            "payload": payload,
                        }
                    )
        except Exception:
            actions = []
    return cleaned, actions


def _sanitize_llm_actions(
    actions: List[Dict[str, Any]],
    context_data: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    today = datetime.now().strftime("%Y-%m-%d")
    accounts = (context_data or {}).get("accounts") or []
    account_ids = {str(a.get("id")) for a in accounts if a.get("id")}
    default_acc_id = str(accounts[0].get("id")) if accounts and accounts[0].get("id") else None

    sanitized: List[Dict[str, Any]] = []
    for act in actions:
        act_type = act.get("type")
        payload = dict(act.get("payload") or {})
        if act_type in ("create_transaction", "create_transfer", "set_budget"):
            raw_amt = payload.get("amount")
            if isinstance(raw_amt, str):
                amt_val = parse_indonesian_amount(raw_amt)
            else:
                try:
                    amt_val = float(raw_amt or 0)
                except (TypeError, ValueError):
                    amt_val = 0.0
            if amt_val <= 0:
                continue
            payload["amount"] = round(amt_val)

        if act_type == "create_transaction":
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", str(payload.get("date") or "")):
                payload["date"] = today
            if str(payload.get("type") or "") not in ("expense", "income"):
                payload["type"] = "expense"
            if account_ids and str(payload.get("account_id") or "") not in account_ids and default_acc_id:
                payload["account_id"] = default_acc_id

        sanitized.append({**act, "payload": payload})
    return sanitized


def parse_advisor_response(
    content: str,
    fallback_actions: Optional[List[Dict[str, Any]]] = None,
    context_data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    disclaimer = "🤖 Saran AI — bukan nasihat keuangan profesional"

    stripped_content, parsed_actions = _extract_actions_block(content)
    parsed_actions = _sanitize_llm_actions(parsed_actions, context_data=context_data)

    # Strip disclaimer from the start if present to handle it cleanly in the frontend
    main_response = stripped_content
    if disclaimer in main_response:
        main_response = main_response.replace(disclaimer, "").strip()

    # Split reason if present
    reason = "Berdasarkan ringkasan data kesehatan keuangan di dashboard Anda."
    if "Alasan:" in main_response:
        parts = main_response.split("Alasan:", 1)
        main_response = parts[0].strip()
        reason = parts[1].strip()

    # Prevent LLM collapse bugs when multi-item deterministic parser detected >=2 separate transactions
    if (
        fallback_actions
        and len(fallback_actions) >= 2
        and len(parsed_actions) < len(fallback_actions)
    ):
        final_actions = fallback_actions
    else:
        final_actions = parsed_actions if parsed_actions else (fallback_actions or [])

    suggested_replies = (
        ["Cek sisa anggaran bulan ini", "Cek kuota jajan harian bulan ini"]
        if final_actions
        else ["Cek kuota jajan harian bulan ini", "Tagihan bulan ini apa saja?", "Bandingkan pengeluaran bulan lalu"]
    )
    result: Dict[str, Any] = {
        "response": main_response,
        "reason": reason,
        "suggested_replies": suggested_replies,
    }
    if final_actions:
        result["proposed_actions"] = final_actions
    return result


def generate_mock_chat_response(
    message: str,
    context_data: Dict[str, Any],
    deterministic_action: Optional[Dict[str, Any]] = None,
    deterministic_actions: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    dashboard = context_data.get("dashboard", {})
    ef = context_data.get("emergency_fund", {})
    budget = context_data.get("budget", {})
    accounts = context_data.get("accounts", []) or []
    categories = context_data.get("categories", []) or []

    actions = list(deterministic_actions or [])
    if not actions:
        if deterministic_action is not None:
            actions = [deterministic_action]
        else:
            actions = parse_indonesian_action_commands(message, accounts, categories)

    if len(actions) == 1:
        single = actions[0]
        return {
            "response": (
                f"Siap! Saya sudah menyiapkan draf aksi **{single['title']}** "
                f"({single['summary']}). Ketuk Konfirmasi atau ubah detail di kartu aksi di bawah."
            ),
            "reason": "agentic-nlp-worker",
            "proposed_actions": actions,
            "suggested_replies": ["Cek kuota jajan harian bulan ini", "Cek pengeluaran terbesar bulan ini"],
        }

    if len(actions) >= 2:
        total_amt = sum(float((a.get("payload") or {}).get("amount") or 0) for a in actions)
        lines = [
            f"{idx}. {a['title'].replace('Catat Pengeluaran: ', '').replace('Catat Pemasukan: ', '')} — {a['summary']}"
            for idx, a in enumerate(actions, start=1)
        ]
        total_str = f"Rp {total_amt:,.0f}".replace(",", ".")
        return {
            "response": (
                f"Siap! Saya sudah memisahkan {len(actions)} draf transaksi (total **{total_str}**):\n"
                + "\n".join(lines)
                + "\n\nKetuk Konfirmasi Semua atau per item di kartu aksi di bawah."
            ),
            "reason": "agentic-nlp-worker-multi",
            "proposed_actions": actions,
            "suggested_replies": ["Cek kuota jajan harian bulan ini", "Cek tagihan bulan ini"],
        }

    # Safe extractor for MoneyValue, DebtSummaryDto, or plain float
    def _val(obj, key: str, default: float = 0.0) -> float:
        v = obj.get(key, default)
        if isinstance(v, dict):
            for field in ("value", "total_outstanding", "total", "amount"):
                if field in v and v.get(field) is not None:
                    v = v.get(field)
                    break
            else:
                v = default
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    net_worth = _val(dashboard, "net_worth")
    cash = _val(dashboard, "cash_available")
    safe_spend = _val(dashboard, "safe_to_spend")
    debts = _val(dashboard, "total_debts")
    dti = dashboard.get("dti_ratio", 0)
    score_obj = dashboard.get("health_score", {})
    score = score_obj.get("score", 0) if isinstance(score_obj, dict) else int(score_obj or 0)
    forecast = _val(dashboard, "forecast_end_month")
    ef_current = _val(ef, "total_emergency_fund")
    ef_target = _val(ef, "target_amount")
    budget_limit = _val(budget, "total_budget")
    budget_spent = _val(budget, "total_spent")
    upcoming_bills = dashboard.get("upcoming_bills") or []
    debts_list = context_data.get("debts") or []
    goals_list = context_data.get("goals") or []
    budget_cats = context_data.get("budget_categories") or []
    spending_analytics = context_data.get("spending_analytics") or {}

    msg_lower = message.lower()
    suggested_replies = [
        "Cek kuota jajan harian bulan ini",
        "Tagihan bulan ini apa saja?",
        "Bandingkan pengeluaran bulan lalu",
    ]

    if any(k in msg_lower for k in ("kuota harian", "cukup sampai", "sehari boleh", "runway", "sisa hari", "aman sampai")):
        rem_days = max(1, int(spending_analytics.get("remaining_days_in_month") or 1))
        daily_burn = float(spending_analytics.get("daily_burn_rate") or 0)
        cur_spent = float(spending_analytics.get("current_month_expense") or 0)
        daily_quota = round(max(0.0, safe_spend) / rem_days)
        gap = safe_spend - (daily_burn * rem_days)
        response = (
            f"Analisis Kuota Harian & Ketahanan Kas ({rem_days} hari tersisa bulan ini):\n"
            f"- **Kuota aman harian**: **Rp {daily_quota:,.0f}/hari** (dari Safe-to-Spend **Rp {safe_spend:,.0f}**).\n"
            f"- **Rata-rata belanja aktual**: **Rp {daily_burn:,.0f}/hari** (total bulan ini Rp {cur_spent:,.0f}).\n"
            + (
                f"- Ritme saat ini masih **cukup** hingga akhir bulan (estimasi sisa **Rp {gap:,.0f}**)."
                if gap >= 0
                else f"- **Peringatan**: berpotensi kurang **Rp {abs(gap):,.0f}** di akhir bulan — batasi di bawah Rp {daily_quota:,.0f}/hari."
            )
        )
        reason = "Dihitung dari Safe-to-Spend berbanding sisa hari kalender dan burn rate harian Anda."
    elif any(k in msg_lower for k in ("lebih boros", "banding", "bulan lalu", "dibanding", "tren pengeluaran")):
        cur_sum = float(spending_analytics.get("current_month_expense") or budget_spent)
        prev_sum = float(spending_analytics.get("prev_month_expense") or 0)
        diff = cur_sum - prev_sum
        top_cats = spending_analytics.get("top_categories") or []
        top_line = (
            "\nPos terbesar bulan ini: "
            + ", ".join(
                f"{c.get('category') or c.get('name') or 'Lainnya'} (Rp {float(c.get('amount') if c.get('amount') is not None else (c.get('total') or 0)):,.0f})"
                for c in top_cats[:3]
            )
            if top_cats
            else ""
        )
        response = (
            f"Perbandingan Pengeluaran Bulan Ini vs Bulan Lalu:\n"
            f"- **Bulan ini**: **Rp {cur_sum:,.0f}** • **Bulan lalu**: **Rp {prev_sum:,.0f}**.\n"
            + (
                "- Belum ada transaksi pembanding di bulan lalu."
                if prev_sum <= 0
                else (
                    f"- Belanja naik **Rp {diff:,.0f}** ({(diff / prev_sum * 100):.1f}%)."
                    if diff > 0
                    else f"- Belanja lebih hemat **Rp {abs(diff):,.0f}** ({abs(diff / prev_sum * 100):.1f}%)."
                )
            )
            + top_line
        )
        reason = "Membandingkan arus pengeluaran bulan berjalan dengan bulan sebelumnya."
    elif any(k in msg_lower for k in ("tagihan", "bill", "jatuh tempo")):
        if upcoming_bills:
            total_b = sum(float(b.get("amount") or 0) for b in upcoming_bills)
            lines = "\n".join(
                f"{i}. **{b.get('name')}** — Rp {float(b.get('amount') or 0):,.0f} ({b.get('days_remaining', '?')} hari lagi)"
                for i, b in enumerate(upcoming_bills[:6], start=1)
            )
            response = (
                f"Tagihan Jatuh Tempo Dekat (Total **Rp {total_b:,.0f}**):\n{lines}\n\n"
                f"Safe-to-Spend tersedia saat ini: **Rp {safe_spend:,.0f}**."
            )
        else:
            response = "Tidak ada tagihan mendesak dalam beberapa hari ke depan."
        reason = "Disarikan dari daftar tagihan aktif terdekat dan saldo Safe-to-Spend Anda."
    elif any(k in msg_lower for k in ("saldo", "rekening", "dompet")):
        acc_lines = [
            f"- **{a.get('name')}** ({a.get('type', 'bank')}): Rp {float(a.get('balance') or 0):,.0f}"
            for a in accounts[:8]
        ]
        response = (
            "Posisi Rekening Aktif Anda:\n"
            + ("\n".join(acc_lines) if acc_lines else "- Belum ada rekening aktif tercatat.")
            + f"\n\nTotal Kas Tersedia: **Rp {cash:,.0f}** (Safe-to-Spend: **Rp {safe_spend:,.0f}**)."
        )
        reason = "Menampilkan ringkasan saldo seluruh rekening aktif dan kapasitas kas likuid."
    elif any(k in msg_lower for k in ("target", "goal", "impian")):
        if goals_list:
            g_lines = "\n".join(
                f"- **{g.get('name')}**: Rp {float(g.get('current_amount') or 0):,.0f} / Rp {float(g.get('target_amount') or 0):,.0f} ({float(g.get('progress') or 0):.0f}%)"
                for g in goals_list[:6]
            )
            response = f"Progres Target Tabungan Anda:\n{g_lines}"
        else:
            response = "Belum ada target tabungan aktif. Ketik misalnya `Buat target dana liburan 10jt` untuk membuatnya."
        reason = "Dihitung dari target tabungan aktif yang tersimpan di akun Anda."
    elif "kondisi" in msg_lower or "keuangan" in msg_lower or "summary" in msg_lower or "dashboard" in msg_lower:
        response = (
            f"Berdasarkan analisis dashboard keuangan Anda:\n"
            f"- **Kekayaan Bersih Anda** saat ini berada di angka **Rp {net_worth:,.0f}** dengan **Kas Tersedia sebesar Rp {cash:,.0f}** (Safe-to-Spend **Rp {safe_spend:,.0f}**).\n"
            f"- **Rasio Debt-to-Income (DTI)** Anda berada pada level **{dti}%**. Level ini tergolong aman jika di bawah 35%.\n"
            f"- **Skor Kesehatan Keuangan** Anda adalah **{score}/100**.\n"
            f"- **Dana Darurat** Anda saat ini terkumpul **Rp {ef_current:,.0f}** dari target **Rp {ef_target:,.0f}**."
        )
        reason = "Analisis didasarkan pada kekayaan bersih, tingkat utang (DTI), skor kesehatan keuangan, dan pencapaian target dana darurat Anda saat ini."
    elif "utang" in msg_lower or "debt" in msg_lower or "cicilan" in msg_lower or "avalanche" in msg_lower:
        if debts_list:
            sorted_av = sorted(debts_list, key=lambda d: float(d.get("interest_rate") or 0), reverse=True)
            sorted_sn = sorted(debts_list, key=lambda d: float(d.get("outstanding_balance") or 0))
            d_lines = "\n".join(
                f"{i}. **{d.get('name')}** — sisa Rp {float(d.get('outstanding_balance') or 0):,.0f}"
                + (f" (bunga {d.get('interest_rate')}%)" if d.get("interest_rate") is not None else "")
                for i, d in enumerate(sorted_av[:5], start=1)
            )
            response = (
                f"Melihat profil utang aktif (Total **Rp {debts:,.0f}**, DTI **{dti}%**):\n{d_lines}\n\n"
                f"1. **Avalanche (hemat bunga)**: prioritaskan **{sorted_av[0].get('name')}**.\n"
                f"2. **Snowball (cepat lunas 1 pos)**: prioritaskan **{sorted_sn[0].get('name')}**."
            )
        else:
            response = (
                f"Melihat data keuangan Anda, total kewajiban/utang Anda adalah **Rp {debts:,.0f}** dengan rasio cicilan DTI sebesar **{dti}%**.\n"
                f"Rekomendasi:\n"
                f"1. Jika rasio DTI > 35%, batasi pembelanjaan non-essential segera dan fokus pada pelunasan utang dengan bunga tertinggi (metode Avalanche) atau saldo terkecil (metode Snowball).\n"
                f"2. Manfaatkan simulator pelunasan utang di menu Utang untuk mensimulasikan percepatan cicilan."
            )
        reason = "Rekomendasi diberikan berdasarkan rasio utang berbanding pendapatan (DTI) sebesar " + str(dti) + "%."
        suggested_replies = ["Cek kuota jajan harian bulan ini", "Tagihan bulan ini apa saja?"]
    elif "anggaran" in msg_lower or "budget" in msg_lower or "hemat" in msg_lower or "boros" in msg_lower or "pengeluaran" in msg_lower:
        remaining = budget_limit - budget_spent
        cat_detail = ""
        if budget_cats:
            top_b = sorted(budget_cats, key=lambda b: float(b.get("used_percentage") or 0), reverse=True)[:4]
            cat_detail = "\nPos kategori tertinggi:\n" + "\n".join(
                f"- **{b.get('category_name')}**: Rp {float(b.get('spent') or 0):,.0f} / Rp {float(b.get('limit') or 0):,.0f} ({float(b.get('used_percentage') or 0):.0f}%)"
                for b in top_b
            )
        response = (
            f"Untuk bulan ini, total batas anggaran Anda adalah **Rp {budget_limit:,.0f}**, dan Anda telah membelanjakan **Rp {budget_spent:,.0f}**.\n"
            f"Sisa anggaran belanja Anda adalah **Rp {remaining:,.0f}**.{cat_detail}\n"
            f"Rekomendasi:\n"
            f"1. Pantau kategori pengeluaran yang mendekati limit di halaman Anggaran.\n"
            f"2. Batasi transaksi impulsif di sisa bulan ini agar proyeksi saldo akhir bulan Anda (Rp {forecast:,.0f}) tetap bernilai positif."
        )
        reason = f"Pengeluaran anggaran Anda sudah mencapai Rp {budget_spent:,.0f} dari batas Rp {budget_limit:,.0f}."
    else:
        response = (
            f"Halo! Saya adalah asisten AI keuangan Anda. Anda menanyakan: \"{message}\"\n\n"
            f"Berdasarkan profil Anda saat ini:\n"
            f"- **Kas Tersedia**: **Rp {cash:,.0f}** (Safe-to-Spend: **Rp {safe_spend:,.0f}**).\n"
            f"- **Rasio DTI**: **{dti}%** (ideal di bawah 35%).\n"
            f"- **Dana Darurat**: terisi **{((ef_current/ef_target)*100) if ef_target > 0 else 0:.1f}%** (**Rp {ef_current:,.0f}** dari **Rp {ef_target:,.0f}**).\n"
            f"- Coba ketik perintah pencatatan cepat seperti `beli kopi 10rb, susu 6rb dan warteg 5rb`."
        )
        reason = "Saran disesuaikan dengan saldo likuid, dana darurat, dan rasio utang Anda."

    return {
        "response": response,
        "reason": reason,
        "suggested_replies": suggested_replies,
    }


# 4. Anomaly Detection Service
def detect_anomalies_rule(
    recent_transactions: List[Dict[str, Any]],
    category_averages: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Detects anomalies:
    - Transactions with amount > 2x the category average.
    - Large transaction spikes (amount > Rp 5,000,000).
    """
    logger.info("Running anomaly detection")
    averages_map = {c["category"]: c["average"] for c in category_averages}
    anomalies = []

    for tx in recent_transactions:
        tx_id = tx.get("id")
        amount = tx.get("amount", 0)
        category = tx.get("category", "Uncategorized")
        desc = tx.get("description", "")
        date = tx.get("date", "")

        avg = averages_map.get(category, 0)
        
        # Anomaly Rule 1: Amount > 2x Category Average (only if average is meaningful, e.g., > 10,000)
        if avg > 10000 and amount > 2 * avg:
            anomalies.append({
                "transaction_id": tx_id,
                "reason": (
                    f"Transaksi di kategori '{category}' sebesar Rp {amount:,.0f} "
                    f"melebihi 2x rata-rata biasanya (Rp {avg:,.0f})."
                )
            })
            continue

        # Anomaly Rule 2: Spending spike (absolute large amounts, e.g. > 5,000,000)
        if amount >= 5000000:
            anomalies.append({
                "transaction_id": tx_id,
                "reason": (
                    f"Pembelanjaan berjumlah besar terdeteksi: Rp {amount:,.0f} "
                    f"pada tanggal {date} ({desc})."
                )
            })

    return {"anomalies": anomalies}
