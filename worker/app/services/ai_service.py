import json
import logging
import base64
import os
from typing import Dict, Any, List, Optional
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


# 3. Advisor Chat Service
async def chat_advisor(
    message: str,
    context_data: Dict[str, Any],
    provider: str,
    model_name: str,
    api_key: Optional[str]
) -> Dict[str, Any]:
    """
    Chats with the AI Financial Advisor.
    Prefixes responses with a disclaimer and reasons using the context provided.
    """
    # 1. Extract context sub-objects
    dashboard = context_data.get("dashboard", {}) or {}
    ef = context_data.get("emergency_fund", {}) or {}
    budget = context_data.get("budget", {}) or {}

    # Helper to safely extract float from plain number or MoneyValue dict
    def _val(obj, key: str, default: float = 0.0) -> float:
        v = obj.get(key, default)
        if isinstance(v, dict):
            return float(v.get("value", default))
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    net_worth     = _val(dashboard, "net_worth")
    cash          = _val(dashboard, "cash_available")
    debts         = _val(dashboard, "total_debts")
    dti           = dashboard.get("dti_ratio", 0)
    score_obj     = dashboard.get("health_score", {})
    score         = score_obj.get("score", 0) if isinstance(score_obj, dict) else score_obj
    score_status  = score_obj.get("status", "N/A") if isinstance(score_obj, dict) else "N/A"
    forecast      = _val(dashboard, "forecast_end_month")

    ef_current    = _val(ef, "total_emergency_fund")
    ef_target     = _val(ef, "target_amount")
    ef_months     = ef.get("coverage_months", 0)

    budget_limit  = _val(budget, "total_budget")
    budget_spent  = _val(budget, "total_spent")
    budget_remaining = _val(budget, "remaining")
    budget_remaining_pct = (budget_remaining / budget_limit * 100) if budget_limit > 0 else 100.0

    context_str = (
        f"Kekayaan Bersih: Rp {net_worth:,.2f}\n"
        f"Kas Tersedia: Rp {cash:,.2f}\n"
        f"Total Utang: Rp {debts:,.2f}\n"
        f"Rasio DTI: {dti}% ({dashboard.get('dti_status', 'N/A')})\n"
        f"Skor Kesehatan Keuangan: {score}/100 ({score_status})\n"
        f"Prediksi Akhir Bulan: Rp {forecast:,.2f}\n"
        f"Status Dana Darurat: Target Rp {ef_target:,.2f}, Terkumpul Rp {ef_current:,.2f} ({ef_months} bulan tercover)\n"
        f"Status Anggaran Bulan Ini: Limit Rp {budget_limit:,.2f}, Terpakai Rp {budget_spent:,.2f} ({budget_remaining_pct:.1f}% tersisa)\n"
    )

    system_prompt = (
        "Anda adalah asisten perencana keuangan pribadi profesional (AI Advisor) untuk keluarga Indonesia. "
        "Jawab pertanyaan user dalam Bahasa Indonesia yang ramah, sopan, namun taktis dan solutif. "
        "Gunakan data finansial aktual di bawah ini untuk menjawab secara spesifik dengan angka.\n\n"
        f"Konteks Finansial User:\n{context_str}\n\n"
        "PENTING:\n"
        "1. JAWABAN ANDA HARUS SELALU diawali dengan baris disclaimer tepat seperti ini:\n"
        "🤖 Saran AI — bukan nasihat keuangan profesional\n\n"
        "2. Di bagian akhir jawaban Anda, Anda HARUS menulis bagian 'Alasan:' yang merangkum alasan di balik rekomendasi Anda berdasarkan data finansial di atas.\n"
        "Format output akhir:\n"
        "🤖 Saran AI — bukan nasihat keuangan profesional\n"
        "[Isi saran detail Anda dengan angka dan rekomendasi konkret]\n\n"
        "Alasan: [Alasan ringkas Anda]"
    )

    if not api_key or provider == "local":
        logger.info("Using mock advisor response")
        return generate_mock_chat_response(message, context_data)

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
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": message},
                ],
                temperature=0.7,
                timeout=60.0,
            )
            return parse_advisor_response(content)
        elif provider == "anthropic":
            headers["anthropic-version"] = "2023-06-01"
            llm_model = model_name if model_name != "default" else "claude-3-5-sonnet-20241022"
            payload = {
                "model": llm_model,
                "max_tokens": 1500,
                "system": system_prompt,
                "messages": [{"role": "user", "content": message}],
                "temperature": 0.7
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post("https://api.anthropic.com/v1/messages", json=payload, headers=headers)
                resp.raise_for_status()
                content = resp.json()["content"][0]["text"]
                return parse_advisor_response(content)
        elif provider == "gemini":
            llm_model = model_name if model_name != "default" else "gemini-2.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{llm_model}:generateContent?key={api_key}"
            payload = {
                "system_instruction": {"parts": [{"text": system_prompt}]},
                "contents": [{"parts": [{"text": message}]}],
                "generationConfig": {"temperature": 0.7},
            }
            async with httpx.AsyncClient(timeout=30.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                return parse_advisor_response(content)
    except Exception as e:
        logger.error(f"Error calling {provider} for advisor chat: {str(e)}")
        return generate_mock_chat_response(message, context_data)

    return generate_mock_chat_response(message, context_data)


def parse_advisor_response(content: str) -> Dict[str, str]:
    disclaimer = "🤖 Saran AI — bukan nasihat keuangan profesional"
    
    # Strip disclaimer from the start if present to handle it cleanly in the frontend
    main_response = content
    if disclaimer in main_response:
        main_response = main_response.replace(disclaimer, "").strip()

    # Split reason if present
    reason = "Berdasarkan ringkasan data kesehatan keuangan di dashboard Anda."
    if "Alasan:" in main_response:
        parts = main_response.split("Alasan:")
        main_response = parts[0].strip()
        reason = parts[1].strip()

    return {
        "response": main_response,
        "reason": reason
    }


def generate_mock_chat_response(message: str, context_data: Dict[str, Any]) -> Dict[str, Any]:
    dashboard = context_data.get("dashboard", {})
    ef = context_data.get("emergency_fund", {})
    budget = context_data.get("budget", {})

    # Safe extractor for MoneyValue or plain float
    def _val(obj, key: str, default: float = 0.0) -> float:
        v = obj.get(key, default)
        if isinstance(v, dict):
            return float(v.get("value", default))
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    net_worth = _val(dashboard, "net_worth")
    cash = _val(dashboard, "cash_available")
    debts = _val(dashboard, "total_debts")
    dti = dashboard.get("dti_ratio", 0)
    score_obj = dashboard.get("health_score", {})
    score = score_obj.get("score", 0) if isinstance(score_obj, dict) else int(score_obj or 0)
    forecast = _val(dashboard, "forecast_end_month")
    ef_current = _val(ef, "total_emergency_fund")
    ef_target = _val(ef, "target_amount")
    budget_limit = _val(budget, "total_budget")
    budget_spent = _val(budget, "total_spent")

    msg_lower = message.lower()
    
    if "kondisi" in msg_lower or "keuangan" in msg_lower or "summary" in msg_lower or "dashboard" in msg_lower:
        response = (
            f"Berdasarkan analisis dashboard keuangan Anda:\n"
            f"- **Kekayaan Bersih Anda** saat ini berada di angka **Rp {net_worth:,.0f}** dengan **Kas Tersedia sebesar Rp {cash:,.0f}**.\n"
            f"- **Rasio Debt-to-Income (DTI)** Anda berada pada level **{dti}%**. Level ini tergolong aman jika di bawah 35%.\n"
            f"- **Skor Kesehatan Keuangan** Anda adalah **{score}/100**. Sistem menilai ini sebagai performa yang cukup baik, namun masih ada ruang untuk optimasi.\n"
            f"- **Dana Darurat** Anda saat ini terkumpul **Rp {ef_current:,.0f}** dari target **Rp {ef_target:,.0f}**. Memenuhi target ini harus menjadi prioritas utama Anda guna mengantisipasi kejadian tak terduga."
        )
        reason = "Analisis didasarkan pada kekayaan bersih, tingkat utang (DTI), skor kesehatan keuangan, dan pencapaian target dana darurat Anda saat ini."
    elif "utang" in msg_lower or "debt" in msg_lower or "cicilan" in msg_lower:
        response = (
            f"Melihat data keuangan Anda, total kewajiban/utang Anda adalah **Rp {debts:,.0f}** dengan rasio cicilan DTI sebesar **{dti}%**.\n"
            f"Rekomendasi:\n"
            f"1. Jika rasio DTI > 35%, batasi pembelanjaan non-essential segera dan fokus pada pelunasan utang dengan bunga tertinggi (metode Avalanche) atau saldo terkecil (metode Snowball).\n"
            f"2. Manfaatkan simulator pelunasan utang di menu Utang untuk mensimulasikan percepatan cicilan."
        )
        reason = "Rekomendasi diberikan berdasarkan rasio utang berbanding pendapatan (DTI) sebesar " + str(dti) + "%."
    elif "anggaran" in msg_lower or "budget" in msg_lower or "hemat" in msg_lower:
        remaining = budget_limit - budget_spent
        response = (
            f"Untuk bulan ini, total batas anggaran Anda adalah **Rp {budget_limit:,.0f}**, dan Anda telah membelanjakan **Rp {budget_spent:,.0f}**.\n"
            f"Sisa anggaran belanja Anda adalah **Rp {remaining:,.0f}**.\n"
            f"Rekomendasi:\n"
            f"1. Pantau kategori pengeluaran yang mendekati limit di halaman Anggaran.\n"
            f"2. Batasi transaksi impulsif di sisa bulan ini agar proyeksi saldo akhir bulan Anda (Rp {dashboard.get('forecast_end_month', {}).get('value', 0):,.0f}) tetap bernilai positif."
        )
        reason = f"Pengeluaran anggaran Anda sudah mencapai Rp {budget_spent:,.0f} dari batas Rp {budget_limit:,.0f}."
    else:
        response = (
            f"Halo! Saya adalah asisten AI keuangan Anda. Anda menanyakan: \"{message}\"\n\n"
            f"Sebagai rekomendasi umum berdasarkan profil Anda saat ini:\n"
            f"- Jaga Rasio DTI Anda di bawah 35% (Saat ini: {dti}%).\n"
            f"- Sisihkan minimal 10-20% pendapatan untuk mengisi Dana Darurat Anda yang baru terisi sebesar {((ef_current/ef_target)*100) if ef_target > 0 else 0:.1f}%.\n"
            f"- Optimalkan alokasi anggaran bulanan Anda agar surplus kas bulanan meningkat."
        )
        reason = "Saran umum disesuaikan dengan status dana darurat dan rasio utang Anda."

    return {
        "response": response,
        "reason": reason
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
