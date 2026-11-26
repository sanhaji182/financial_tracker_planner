import base64
import io
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pdfplumber
from PIL import Image, ImageOps
import pytesseract

from app.services.ai_service import _extract_json_text
from app.services.ocr_service import (
    PDFPasswordError,
    clean_amount,
    get_tesseract_lang,
    is_pdf_password_error,
    preprocess_image_variants,
    raise_pdf_password_error,
)
from app.services.pdf_service import parse_pdf_mutasi

try:
    from pdf2image import convert_from_bytes
except ImportError:
    convert_from_bytes = None

logger = logging.getLogger("worker.snapshot")

ALLOWED_DEBT_TYPES = {"kpr", "credit_card", "installment", "personal_loan", "other"}
ALLOWED_ACCOUNT_TYPES = {"bank", "e_wallet", "cash", "investment", "deposit"}
ALLOWED_CURRENCIES = {"IDR", "USD", "SGD", "EUR"}

MONTHS_MAP = {
    "jan": "01",
    "januari": "01",
    "january": "01",
    "feb": "02",
    "februari": "02",
    "february": "02",
    "mar": "03",
    "maret": "03",
    "march": "03",
    "apr": "04",
    "april": "04",
    "mei": "05",
    "may": "05",
    "jun": "06",
    "juni": "06",
    "june": "06",
    "jul": "07",
    "juli": "07",
    "july": "07",
    "agu": "08",
    "ags": "08",
    "agustus": "08",
    "aug": "08",
    "august": "08",
    "sep": "09",
    "sept": "09",
    "september": "09",
    "okt": "10",
    "oktober": "10",
    "oct": "10",
    "october": "10",
    "nov": "11",
    "november": "11",
    "des": "12",
    "desember": "12",
    "dec": "12",
    "december": "12",
}

DEBT_PROVIDERS: List[Tuple[str, str, str, Tuple[str, ...]]] = [
    ("SPayLater", "Shopee / SPayLater", "installment", ("spaylater", "shopee paylater", "shopeepaylater", "spay later")),
    ("SPinjam", "Shopee / SPinjam", "personal_loan", ("spinjam", "shopee pinjam")),
    ("GoPayLater", "GoPay / GoPayLater", "installment", ("gopaylater", "gopay later", "paylater cicil")),
    ("GoPay Pinjam", "GoPay Pinjam", "personal_loan", ("gopay pinjam",)),
    ("Kredivo", "Kredivo", "installment", ("kredivo",)),
    ("Akulaku", "Akulaku", "installment", ("akulaku",)),
    ("Indodana", "Indodana", "installment", ("indodana",)),
    ("Atome", "Atome", "installment", ("atome",)),
    ("Home Credit", "Home Credit", "installment", ("home credit", "homecredit")),
    ("Adira Finance", "Adira Finance", "installment", ("adira", "adira finance")),
    ("FIFGROUP", "FIFGROUP", "installment", ("fifgroup", "fif group", "fifastra")),
    ("BCA Finance", "BCA Finance", "installment", ("bca finance",)),
    ("OTO Finance", "OTO Finance", "installment", ("oto finance", "oto kredit")),
    ("Kredit Pintar", "Kredit Pintar", "personal_loan", ("kredit pintar",)),
    ("AdaKami", "AdaKami", "personal_loan", ("adakami",)),
    ("EasyCash", "EasyCash", "personal_loan", ("easycash",)),
    ("Tunaiku", "Tunaiku", "personal_loan", ("tunaiku",)),
    ("Jenius Flexi Cash", "Bank BTPN / Jenius", "personal_loan", ("flexi cash", "flexicash")),
    ("Kartu Kredit BCA", "Bank BCA", "credit_card", ("kartu kredit bca", "bca card", "bca visa", "bca mastercard")),
    ("Kartu Kredit Mandiri", "Bank Mandiri", "credit_card", ("kartu kredit mandiri", "mandiri kartu kredit", "livin paylater")),
    ("Kartu Kredit BNI", "Bank BNI", "credit_card", ("kartu kredit bni",)),
    ("Kartu Kredit BRI", "Bank BRI", "credit_card", ("kartu kredit bri", "bri kartu kredit")),
    ("Kartu Kredit CIMB Niaga", "CIMB Niaga", "credit_card", ("kartu kredit cimb", "cimb niaga card")),
    ("Kartu Kredit Permata", "Permata Bank", "credit_card", ("kartu kredit permata",)),
    ("Kartu Kredit OCBC", "OCBC Indonesia", "credit_card", ("kartu kredit ocbc",)),
    ("Kartu Kredit Danamon", "Bank Danamon", "credit_card", ("kartu kredit danamon",)),
    ("Tokopedia Card", "BRI / Tokopedia Card", "credit_card", ("tokopedia card",)),
    ("Jenius Credit Card", "Bank SMBC / Jenius", "credit_card", ("jenius credit card", "d-card")),
    ("KPR BTN", "Bank BTN", "kpr", ("kpr btn", "btn kpr")),
    ("KPR BCA", "Bank BCA", "kpr", ("kpr bca",)),
    ("KPR Mandiri", "Bank Mandiri", "kpr", ("kpr mandiri",)),
]

ACCOUNT_PROVIDERS: List[Tuple[str, str, Tuple[str, ...]]] = [
    ("BCA", "bank", ("bank central asia", "mybca", "bca mobile", "klikbca", "tahapan bca", "xpresi", " bca ", "bca")),
    ("Mandiri", "bank", ("bank mandiri", "livin", "mandiri")),
    ("BNI", "bank", ("bank negara indonesia", "wondr", "bni mobile", " bni ", "bni")),
    ("BRI", "bank", ("bank rakyat indonesia", "brimo", "britama", "simpedes", " bri ", "bri")),
    ("BSI", "bank", ("bank syariah indonesia", "byond", "bsi mobile", " bsi ", "bsi")),
    ("CIMB Niaga", "bank", ("cimb niaga", "octo mobile", "octo clicks", "cimb")),
    ("Permata", "bank", ("permata bank", "permatabank", "permatame")),
    ("Danamon", "bank", ("bank danamon", "danamon", "d-bank")),
    ("Bank Jago", "bank", ("bank jago", "pt bank jago", "jago")),
    ("SeaBank", "bank", ("seabank", "pt bank seabank")),
    ("Jenius", "bank", ("jenius", "btpn", "smbc")),
    ("blu by BCA Digital", "bank", ("blu by bca", "bca digital", "blusaving")),
    ("OCBC", "bank", ("ocbc", "nyala")),
    ("BTN", "bank", ("bank btn", "btn mobile", "tabungan btn")),
    ("Bank Mega", "bank", ("bank mega", "m-smile")),
    ("Maybank", "bank", ("maybank", "m2u")),
    ("Panin Bank", "bank", ("panin",)),
    ("GoPay", "e_wallet", ("gopay", "go-pay")),
    ("OVO", "e_wallet", ("ovo cash", "ovo points", " ovo ")),
    ("DANA", "e_wallet", ("dana indonesia", "saldo dana", "dompet dana")),
    ("ShopeePay", "e_wallet", ("shopeepay", "shopee pay", "spay")),
    ("LinkAja", "e_wallet", ("linkaja", "link aja")),
    ("AstraPay", "e_wallet", ("astrapay",)),
    ("Bibit", "investment", ("bibit", "reksadana bibit")),
    ("Bareksa", "investment", ("bareksa",)),
    ("Stockbit", "investment", ("stockbit",)),
    ("Ajaib", "investment", ("ajaib",)),
    ("Pluang", "investment", ("pluang",)),
    ("IPOT", "investment", ("ipot", "indo premier")),
]

LIMIT_EXCLUSION_PATTERN = re.compile(
    r"\b(limit\s*tersedia|sisa\s*limit|total\s*limit|limit\s*kredit|available\s*limit|"
    r"available\s*credit|credit\s*limit|batas\s*kredit|plafon\s*tersedia|maksimal\s*limit)\b",
    re.IGNORECASE,
)


def _encode_pil_to_base64(image: Image.Image, max_width: int = 1600) -> Tuple[str, str]:
    rgb = ImageOps.exif_transpose(image)
    if rgb.mode != "RGB":
        rgb = rgb.convert("RGB")
    w, h = rgb.size
    if w > max_width:
        target_h = max(1, int(h * (max_width / w)))
        rgb = rgb.resize((max_width, target_h), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    rgb.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii"), "image/png"


def extract_snapshot_source(
    file_bytes: bytes,
    filename: str = "",
    pdf_password: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Extracts text (digital PDF or Tesseract ind+eng OCR) and prepares a normalized
    PNG base64 image for optional AI Vision escalation.
    """
    lang = get_tesseract_lang()
    tesseract_config = "--oem 3 --psm 6"
    is_pdf = (filename or "").lower().endswith(".pdf") or file_bytes[:4] == b"%PDF"

    if not is_pdf:
        variants = preprocess_image_variants(file_bytes)
        text = pytesseract.image_to_string(variants[0], lang=lang, config=tesseract_config).strip()
        if len(text) < 40 and len(variants) > 1:
            alt_text = pytesseract.image_to_string(variants[1], lang=lang, config=tesseract_config).strip()
            if len(alt_text) > len(text):
                text = alt_text

        with Image.open(io.BytesIO(file_bytes)) as raw_img:
            img_b64, mime_type = _encode_pil_to_base64(raw_img)

        return {
            "is_pdf": False,
            "raw_text": text,
            "engine": f"tesseract ({lang})",
            "extraction_method": "image_ocr",
            "image_base64": img_b64,
            "mime_type": mime_type,
        }

    digital_chunks: List[str] = []
    try:
        with pdfplumber.open(io.BytesIO(file_bytes), password=pdf_password or None) as pdf:
            for page in pdf.pages[:10]:
                digital_chunks.append(page.extract_text() or "")
    except Exception as exc:
        if is_pdf_password_error(exc):
            raise_pdf_password_error(pdf_password)
        raise

    digital_text = "\n\n".join(c for c in digital_chunks if c.strip()).strip()
    img_b64: Optional[str] = None
    mime_type = "image/png"

    if len(digital_text) >= 40:
        if convert_from_bytes is not None:
            try:
                preview_kwargs: Dict[str, Any] = {"dpi": 150, "first_page": 1, "last_page": 1}
                if pdf_password:
                    preview_kwargs["userpw"] = pdf_password
                first_imgs = convert_from_bytes(file_bytes, **preview_kwargs)
                if first_imgs:
                    img_b64, mime_type = _encode_pil_to_base64(first_imgs[0])
            except Exception as exc:
                if is_pdf_password_error(exc):
                    raise_pdf_password_error(pdf_password)
        return {
            "is_pdf": True,
            "raw_text": digital_text,
            "engine": "pdfplumber",
            "extraction_method": "digital_pdf",
            "image_base64": img_b64,
            "mime_type": mime_type,
        }

    if convert_from_bytes is None:
        return {
            "is_pdf": True,
            "raw_text": digital_text,
            "engine": "pdfplumber",
            "extraction_method": "digital_pdf",
            "image_base64": None,
            "mime_type": mime_type,
        }

    convert_kwargs: Dict[str, Any] = {"dpi": 200, "first_page": 1, "last_page": 5}
    if pdf_password:
        convert_kwargs["userpw"] = pdf_password
    try:
        images = convert_from_bytes(file_bytes, **convert_kwargs)
    except Exception as exc:
        if is_pdf_password_error(exc):
            raise_pdf_password_error(pdf_password)
        raise

    ocr_chunks: List[str] = []
    for idx, img in enumerate(images):
        if idx == 0:
            img_b64, mime_type = _encode_pil_to_base64(img)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        variant = preprocess_image_variants(buf.getvalue())[0]
        ocr_chunks.append(pytesseract.image_to_string(variant, lang=lang, config=tesseract_config))

    return {
        "is_pdf": True,
        "raw_text": "\n\n".join(c.strip() for c in ocr_chunks if c.strip()),
        "engine": f"tesseract ({lang})",
        "extraction_method": "scanned_pdf_ocr",
        "image_base64": img_b64,
        "mime_type": mime_type,
    }


async def _call_vision_json(
    prompt: str,
    image_base64: Optional[str],
    mime_type: str,
    provider: str,
    model_name: str,
    api_key: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Calls OpenAI / Anthropic / Gemini with optional vision image and returns parsed JSON dict."""
    if not api_key or not provider or provider == "local":
        return None

    try:
        if provider == "openai":
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            llm_model = model_name if model_name and model_name != "default" else "gpt-4o-mini"
            user_content: List[Dict[str, Any]] = [{"type": "text", "text": prompt}]
            if image_base64:
                user_content.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{image_base64}"},
                    }
                )
            payload = {
                "model": llm_model,
                "response_format": {"type": "json_object"},
                "messages": [{"role": "user", "content": user_content}],
                "temperature": 0.1,
            }
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions", json=payload, headers=headers
                )
                resp.raise_for_status()
                content = resp.json()["choices"][0]["message"]["content"]
                return _extract_json_text(content)

        if provider == "anthropic":
            headers = {
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            }
            llm_model = (
                model_name
                if model_name and model_name != "default"
                else "claude-sonnet-5-5"
            )
            user_content = []
            if image_base64:
                user_content.append(
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type,
                            "data": image_base64,
                        },
                    }
                )
            user_content.append({"type": "text", "text": prompt + "\nReturn ONLY raw JSON."})
            payload = {
                "model": llm_model,
                "max_tokens": 1200,
                "messages": [{"role": "user", "content": user_content}],
                "temperature": 0.1,
            }
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages", json=payload, headers=headers
                )
                resp.raise_for_status()
                content = resp.json()["content"][0]["text"]
                return _extract_json_text(content)

        if provider == "gemini":
            llm_model = (
                model_name if model_name and model_name != "default" else "gemini-2.5-flash"
            )
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{llm_model}:generateContent?key={api_key}"
            parts: List[Dict[str, Any]] = [{"text": prompt}]
            if image_base64:
                parts.append(
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": image_base64,
                        }
                    }
                )
            payload = {
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "temperature": 0.1,
                    "responseMimeType": "application/json",
                },
            }
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                content = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                return _extract_json_text(content)
    except Exception as exc:
        logger.warning(f"Vision LLM extraction failed ({provider}), falling back to heuristic: {exc}")
        return None

    return None


def _detect_currency(text: str, default: str = "IDR") -> str:
    upper = (text or "").upper()
    if re.search(r"\bUSD\b|US\$", upper):
        return "USD"
    if re.search(r"\bSGD\b|S\$", upper):
        return "SGD"
    if re.search(r"\bEUR\b|€", upper):
        return "EUR"
    if re.search(r"\b(RP|IDR)\b", upper):
        return "IDR"
    return default


def _extract_date_from_text(text: str) -> str:
    """Extracts YYYY-MM-DD from Indonesian or ISO date strings."""
    if not text:
        return ""

    iso_match = re.search(r"\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b", text)
    if iso_match:
        y, m, d = iso_match.groups()
        if 1 <= int(m) <= 12 and 1 <= int(d) <= 31:
            return f"{y}-{int(m):02d}-{int(d):02d}"

    months_regex = "|".join(sorted(MONTHS_MAP.keys(), key=len, reverse=True))
    word_match = re.search(
        rf"\b(\d{{1,2}})\s+({months_regex})\s+(20\d{{2}})\b",
        text,
        re.IGNORECASE,
    )
    if word_match:
        d_w, m_w, y_w = word_match.groups()
        m_num = MONTHS_MAP.get(m_w.lower(), "")
        if m_num and 1 <= int(d_w) <= 31:
            return f"{y_w}-{m_num}-{int(d_w):02d}"

    dmy_match = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b", text)
    if dmy_match:
        d, m, y = dmy_match.groups()
        if len(y) == 2:
            y = "20" + y
        if 1 <= int(m) <= 12 and 1 <= int(d) <= 31:
            return f"{y}-{int(m):02d}-{int(d):02d}"

    return ""


def _extract_amount_from_line(line: str, keyword_pattern: str) -> Optional[float]:
    m = re.search(
        rf"(?:{keyword_pattern})[:\s\-]*(?:[Rr]p\.?\s*|IDR\s*|USD\s*|SGD\s*|EUR\s*)?([\d.,]+)",
        line,
        re.IGNORECASE,
    )
    if not m:
        return None
    val = clean_amount(m.group(1))
    return val if val > 0 else None


def _extract_amount_from_lines_or_next(
    lines: List[str],
    keyword_pattern: str,
    exclude_pattern: Optional[re.Pattern] = None,
) -> Optional[float]:
    for idx, line in enumerate(lines):
        if exclude_pattern and exclude_pattern.search(line):
            continue
        if not re.search(keyword_pattern, line, re.IGNORECASE):
            continue
        val = _extract_amount_from_line(line, keyword_pattern)
        if val is not None:
            return val
        if idx + 1 < len(lines):
            next_line = lines[idx + 1]
            if exclude_pattern and exclude_pattern.search(next_line):
                continue
            next_match = re.search(
                r"(?:[Rr]p\.?\s*|IDR\s*|USD\s*|SGD\s*|EUR\s*)?([\d.,]{4,})",
                next_line,
            )
            if next_match:
                val_next = clean_amount(next_match.group(1))
                if val_next > 0:
                    return val_next
    return None


def _safe_float(val: Any) -> Optional[float]:
    if val is None or val == "":
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, str):
        parsed = clean_amount(val)
        return parsed if parsed > 0 or val.strip() == "0" else None
    return None


def _safe_int(val: Any) -> Optional[int]:
    if val is None or val == "":
        return None
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def _normalize_debt_type(raw_type: Any, text_hint: str = "") -> str:
    t = str(raw_type or "").strip().lower()
    if t in ALLOWED_DEBT_TYPES:
        return t
    if "kpr" in t or "mortgage" in t or "rumah" in t:
        return "kpr"
    if "credit" in t or "kartu" in t or t == "cc":
        return "credit_card"
    if "paylater" in t or "bnpl" in t or "cicil" in t or "installment" in t:
        return "installment"
    if "pinjam" in t or "loan" in t or "kta" in t or "pinjol" in t:
        return "personal_loan"

    hint = (text_hint or "").lower()
    if any(k in hint for k in ("kpr", "kredit pemilikan rumah", "angsuran rumah")):
        return "kpr"
    if any(k in hint for k in ("kartu kredit", "credit card", "visa", "mastercard", "jcb", "tokopedia card")):
        return "credit_card"
    if any(k in hint for k in ("spinjam", "gopay pinjam", "kredit pintar", "adakami", "easycash", "tunaiku", "kta")):
        return "personal_loan"
    if any(k in hint for k in ("spaylater", "paylater", "kredivo", "akulaku", "indodana", "atome", "cicilan")):
        return "installment"
    return "other"


def _normalize_account_type(raw_type: Any, text_hint: str = "") -> str:
    t = str(raw_type or "").strip().lower()
    if t in ALLOWED_ACCOUNT_TYPES:
        return t
    if "wallet" in t or "dompet" in t:
        return "e_wallet"
    if "invest" in t or "reksa" in t or "saham" in t:
        return "investment"
    if "deposit" in t or "deposito" in t:
        return "deposit"
    if "cash" in t or "tunai" in t:
        return "cash"
    hint = (text_hint or "").lower()
    if any(k in hint for k in ("deposito", "time deposit")):
        return "deposit"
    if any(k in hint for k in ("gopay", "ovo", "dana", "shopeepay", "linkaja", "astrapay")):
        return "e_wallet"
    if any(k in hint for k in ("bibit", "bareksa", "stockbit", "ajaib", "pluang", "ipot", "portofolio")):
        return "investment"
    return "bank"


def _detect_debt_provider(text: str) -> Tuple[str, str, str]:
    lower = f" {(text or '').lower()} "
    for name, creditor, debt_type, keywords in DEBT_PROVIDERS:
        if any(kw in lower for kw in keywords):
            return name, creditor, debt_type

    if "kartu kredit" in lower or "credit card" in lower:
        return "Kartu Kredit", "Bank Penerbit", "credit_card"
    if "paylater" in lower:
        return "PayLater", "Layanan PayLater", "installment"
    if "kpr" in lower:
        return "KPR", "Bank KPR", "kpr"
    return "", "", "other"


def _detect_account_provider(text: str) -> Tuple[str, str]:
    lower = f" {(text or '').lower()} "
    if "deposito" in lower or "time deposit" in lower:
        for bank_name, _, keywords in ACCOUNT_PROVIDERS:
            if any(kw in lower for kw in keywords):
                return bank_name, "deposit"
        return "", "deposit"

    for provider, acc_type, keywords in ACCOUNT_PROVIDERS:
        if any(kw in lower for kw in keywords):
            return provider, acc_type
    return "", "bank"


def parse_debt_snapshot_heuristic(
    raw_text: str,
    engine: str = "tesseract (ind+eng)",
    extraction_method: str = "image_ocr",
) -> Dict[str, Any]:
    lines = [ln.strip() for ln in (raw_text or "").splitlines() if ln.strip()]
    text = "\n".join(lines)
    warnings: List[str] = []

    detected_name, detected_creditor, detected_type = _detect_debt_provider(text)
    currency = _detect_currency(text, "IDR")

    # Credit limit info (kept strictly out of outstanding_balance / minimum_payment, optionally saved in notes)
    credit_limit = _extract_amount_from_lines_or_next(
        lines,
        r"(?:limit\s*tersedia|sisa\s*limit|total\s*limit|available\s*limit|available\s*credit|credit\s*limit|batas\s*kredit|plafon\s*tersedia)",
    )

    outstanding_kw = (
        r"total\s*sisa\s*tagihan|total\s*tagihan|sisa\s*tagihan|sisa\s*utang|sisa\s*pokok|"
        r"total\s*kewajiban|saldo\s*terutang|total\s*belum\s*dibayar|jumlah\s*tagihan|"
        r"outstanding(?:\s*balance)?|new\s*balance"
    )
    minimum_kw = (
        r"tagihan\s*bulan\s*ini|tagihan\s*jatuh\s*tempo|tagihan\s*berikutnya|"
        r"pembayaran\s*minimum|minimum\s*payment|min\.?\s*payment|harus\s*dibayar|"
        r"cicilan\s*per\s*bulan|angsuran\s*per\s*bulan|cicilan|angsuran"
    )
    original_kw = (
        r"total\s*pinjaman(?:\s*awal)?|pinjaman\s*awal|pokok\s*pinjaman|nilai\s*pinjaman|original\s*amount"
    )

    outstanding = _extract_amount_from_lines_or_next(lines, outstanding_kw, LIMIT_EXCLUSION_PATTERN)
    minimum_payment = _extract_amount_from_lines_or_next(lines, minimum_kw, LIMIT_EXCLUSION_PATTERN)
    original_amount = _extract_amount_from_lines_or_next(lines, original_kw, LIMIT_EXCLUSION_PATTERN)

    if outstanding is None and minimum_payment is not None:
        outstanding = minimum_payment
        warnings.append("Total sisa tagihan tidak ditemukan terpisah, sementara diisi dari tagihan bulan ini.")

    if outstanding is None:
        outstanding = 0.0

    if original_amount is None:
        if outstanding > 0:
            original_amount = outstanding
            warnings.append("Total pinjaman awal tidak tercantum di dokumen, disamakan dengan sisa tagihan.")
        else:
            original_amount = 0.0

    # Due day extraction
    due_day: Optional[int] = None
    for idx, line in enumerate(lines):
        if re.search(r"jatuh\s*tempo|due\s*date|bayar\s*sebelum|batas\s*bayar|tgl\.?\s*jatuh", line, re.IGNORECASE):
            segment = line + (" " + lines[idx + 1] if idx + 1 < len(lines) else "")
            extracted_date = _extract_date_from_text(segment)
            if extracted_date:
                due_day = int(extracted_date.split("-")[2])
                break
            tgl_match = re.search(r"\b(?:tgl|tanggal)\s*(\d{1,2})\b", segment, re.IGNORECASE)
            if tgl_match:
                d_num = int(tgl_match.group(1))
                if 1 <= d_num <= 31:
                    due_day = d_num
                    break

    # Interest rate extraction (annualize monthly rate if /bulan or p.m.)
    interest_rate: Optional[float] = None
    rate_match = re.search(
        r"(?:bunga|suku\s*bunga|interest(?:\s*rate)?)[:\s]*(\d+(?:[.,]\d+)?)\s*%\s*(?:per\s*bulan|/bulan|/bln|p\.?m\.?|per\s*tahun|/tahun|/thn|p\.?a\.?)?",
        text,
        re.IGNORECASE,
    )
    if not rate_match:
        rate_match = re.search(
            r"(\d+(?:[.,]\d+)?)\s*%\s*(per\s*bulan|/bulan|/bln|p\.?m\.?|per\s*tahun|/tahun|/thn|p\.?a\.?)",
            text,
            re.IGNORECASE,
        )
    if rate_match:
        raw_rate = float(rate_match.group(1).replace(",", "."))
        matched_slice = rate_match.group(0).lower()
        if any(k in matched_slice for k in ("bulan", "/bln", "p.m", "pm")):
            interest_rate = round(raw_rate * 12, 2)
            warnings.append(
                f"Suku bunga bulanan ({raw_rate}%) dikonversi otomatis menjadi tahunan ({interest_rate}% p.a.)."
            )
        else:
            interest_rate = round(raw_rate, 2)

    # Tenor extraction
    tenor_months: Optional[int] = None
    ratio_tenor = re.search(r"(?:cicilan|angsuran|periode|tenor)?\s*(\d{1,3})\s*/\s*(\d{1,3})\b", text, re.IGNORECASE)
    if ratio_tenor:
        total_t = int(ratio_tenor.group(2))
        if 1 <= total_t <= 360:
            tenor_months = total_t
    if tenor_months is None:
        tenor_match = re.search(r"(?:tenor|jangka\s*waktu)[:\s]*(\d{1,3})\s*(?:bulan|bln|x)?", text, re.IGNORECASE)
        if tenor_match:
            total_t = int(tenor_match.group(1))
            if 1 <= total_t <= 360:
                tenor_months = total_t
    if tenor_months is None:
        x_match = re.search(r"\b(\d{1,2})\s*(?:x\s*cicilan|bulan)\b", text, re.IGNORECASE)
        if x_match:
            total_t = int(x_match.group(1))
            if 1 <= total_t <= 360:
                tenor_months = total_t

    notes_parts: List[str] = []
    if credit_limit and credit_limit > 0:
        notes_parts.append(f"Limit terdeteksi: Rp {credit_limit:,.0f}")
    if ratio_tenor:
        notes_parts.append(f"Progres cicilan: {ratio_tenor.group(1)}/{ratio_tenor.group(2)}")

    name_conf = 0.88 if detected_name else 0.45
    out_conf = 0.9 if outstanding > 0 else 0.35
    min_conf = 0.85 if minimum_payment is not None else 0.5
    due_conf = 0.85 if due_day is not None else 0.45

    scores = [name_conf, out_conf]
    if minimum_payment is not None:
        scores.append(min_conf)
    if due_day is not None:
        scores.append(due_conf)
    overall_confidence = round(sum(scores) / len(scores), 2)

    return {
        "mode": "debt",
        "engine": engine,
        "extraction_method": extraction_method,
        "raw_text": text,
        "parsed_debt": {
            "name": detected_name or (lines[0][:60] if lines else ""),
            "type": detected_type if detected_type in ALLOWED_DEBT_TYPES else "other",
            "creditor": detected_creditor,
            "original_amount": float(original_amount),
            "outstanding_balance": float(outstanding),
            "minimum_payment": float(minimum_payment) if minimum_payment is not None else None,
            "interest_rate": interest_rate,
            "due_day": due_day,
            "tenor_months": tenor_months,
            "currency": currency if currency in ALLOWED_CURRENCIES else "IDR",
            "notes": "; ".join(notes_parts),
        },
        "confidence_scores": {
            "name": name_conf,
            "outstanding_balance": out_conf,
            "minimum_payment": min_conf,
            "due_day": due_conf,
        },
        "overall_confidence": overall_confidence,
        "needs_review": overall_confidence < 0.7 or outstanding <= 0,
        "warnings": warnings,
    }


async def parse_debt_snapshot(
    file_bytes: bytes,
    filename: str = "",
    pdf_password: Optional[str] = None,
    provider: str = "local",
    model_name: str = "default",
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    source = extract_snapshot_source(file_bytes, filename, pdf_password)
    heuristic = parse_debt_snapshot_heuristic(
        source["raw_text"],
        engine=source["engine"],
        extraction_method=source["extraction_method"],
    )

    if api_key and provider and provider != "local":
        prompt = (
            "You are an expert Indonesian personal finance parser for debt statements and PayLater/credit card screenshots "
            "(SPayLater, GoPayLater, Kredivo, Akulaku, Indodana, Kartu Kredit BCA/Mandiri/BNI/BRI/CIMB/Jenius, KPR).\n"
            f"Raw extracted text:\n{source['raw_text']}\n\n"
            "IMPORTANT RULES:\n"
            "- NEVER confuse available credit limit ('Limit Tersedia', 'Sisa Limit', 'Total Limit', 'Credit Limit') with debt/tagihan.\n"
            "- type MUST be strictly one of: kpr, credit_card, installment, personal_loan, other. Map PayLater/BNPL to 'installment'. Map SPinjam/KTA/Pinjol to 'personal_loan'.\n"
            "- interest_rate is annual percentage (% p.a.). If the screenshot shows monthly interest (e.g. 2.95%/bulan), multiply by 12.\n"
            "- due_day is integer 1..31.\n"
            "- If original_amount is not visible, set it equal to outstanding_balance.\n"
            "Return ONLY raw JSON matching this schema:\n"
            "{\n"
            '  "name": "string",\n'
            '  "type": "kpr|credit_card|installment|personal_loan|other",\n'
            '  "creditor": "string",\n'
            '  "original_amount": number,\n'
            '  "outstanding_balance": number,\n'
            '  "minimum_payment": number|null,\n'
            '  "interest_rate": number|null,\n'
            '  "due_day": integer|null,\n'
            '  "tenor_months": integer|null,\n'
            '  "currency": "IDR|USD|SGD|EUR",\n'
            '  "notes": "string",\n'
            '  "warnings": ["string"]\n'
            "}"
        )
        ai_data = await _call_vision_json(
            prompt,
            source.get("image_base64"),
            source.get("mime_type", "image/png"),
            provider,
            model_name,
            api_key,
        )
        if isinstance(ai_data, dict):
            base = heuristic["parsed_debt"]
            out_bal = _safe_float(ai_data.get("outstanding_balance"))
            if out_bal is None:
                out_bal = base["outstanding_balance"]
            orig_amt = _safe_float(ai_data.get("original_amount"))
            warnings = list(heuristic["warnings"])
            if isinstance(ai_data.get("warnings"), list):
                for w in ai_data["warnings"]:
                    if isinstance(w, str) and w.strip() and w not in warnings:
                        warnings.append(w.strip())
            if orig_amt is None or orig_amt <= 0:
                orig_amt = out_bal if out_bal > 0 else base["original_amount"]
                if out_bal > 0 and not any("pinjaman awal" in w.lower() for w in warnings):
                    warnings.append(
                        "Total pinjaman awal tidak tercantum di dokumen, disamakan dengan sisa tagihan."
                    )

            min_pay = _safe_float(ai_data.get("minimum_payment"))
            if min_pay is None:
                min_pay = base["minimum_payment"]

            due_day = _safe_int(ai_data.get("due_day"))
            if due_day is None or not (1 <= due_day <= 31):
                due_day = base["due_day"]

            tenor = _safe_int(ai_data.get("tenor_months"))
            if tenor is None or tenor < 1:
                tenor = base["tenor_months"]

            rate = _safe_float(ai_data.get("interest_rate"))
            if rate is None:
                rate = base["interest_rate"]

            curr = str(ai_data.get("currency") or base["currency"] or "IDR").upper()
            if curr not in ALLOWED_CURRENCIES:
                curr = "IDR"

            name_val = str(ai_data.get("name") or base["name"] or "").strip()
            creditor_val = str(ai_data.get("creditor") or base["creditor"] or "").strip()
            norm_type = _normalize_debt_type(ai_data.get("type"), f"{name_val} {creditor_val}")

            return {
                "mode": "debt",
                "engine": f"ai_vision ({provider})",
                "extraction_method": source["extraction_method"],
                "raw_text": source["raw_text"],
                "parsed_debt": {
                    "name": name_val,
                    "type": norm_type,
                    "creditor": creditor_val,
                    "original_amount": float(orig_amt),
                    "outstanding_balance": float(out_bal),
                    "minimum_payment": float(min_pay) if min_pay is not None else None,
                    "interest_rate": rate,
                    "due_day": due_day,
                    "tenor_months": tenor,
                    "currency": curr,
                    "notes": str(ai_data.get("notes") or base["notes"] or "").strip(),
                },
                "confidence_scores": {
                    "name": 0.94,
                    "outstanding_balance": 0.95 if out_bal > 0 else 0.4,
                    "minimum_payment": 0.9 if min_pay is not None else 0.6,
                    "due_day": 0.9 if due_day is not None else 0.6,
                },
                "overall_confidence": 0.93 if out_bal > 0 else 0.65,
                "needs_review": out_bal <= 0,
                "warnings": warnings,
            }

    return heuristic


def parse_debt_payment_heuristic(
    raw_text: str,
    engine: str = "tesseract (ind+eng)",
    extraction_method: str = "image_ocr",
) -> Dict[str, Any]:
    lines = [ln.strip() for ln in (raw_text or "").splitlines() if ln.strip()]
    text = "\n".join(lines)
    warnings: List[str] = []

    amount_kw = (
        r"total\s*(?:pembayaran|bayar|dibayar)|jumlah\s*(?:pembayaran|bayar)|"
        r"nominal(?:\s*pembayaran)?|berhasil\s*dibayar|jumlah\s*transfer|total\s*transaksi"
    )
    amount = _extract_amount_from_lines_or_next(lines, amount_kw)
    if amount is None:
        # Fallback to largest Rp amount on receipt
        candidates = [
            clean_amount(m)
            for m in re.findall(r"(?:[Rr]p\.?\s*|IDR\s*)([\d.,]{4,})", text)
        ]
        valid = [c for c in candidates if c > 0]
        if valid:
            amount = max(valid)
            warnings.append("Label nominal spesifik tidak terbaca; menggunakan nominal Rp terbesar yang ditemukan.")

    if amount is None:
        amount = 0.0

    payment_date = _extract_date_from_text(text)

    source_account_hint = ""
    for line in lines:
        if re.search(r"sumber\s*dana|metode\s*pembayaran|rekening\s*sumber|dari\s*rekening|bayar\s*dengan", line, re.IGNORECASE):
            prov, _ = _detect_account_provider(line)
            if prov:
                source_account_hint = prov
                break
    if not source_account_hint:
        prov, _ = _detect_account_provider(text)
        source_account_hint = prov

    creditor_name, creditor_company, _ = _detect_debt_provider(text)
    creditor_hint = creditor_name or creditor_company

    ref_number = ""
    ref_match = re.search(
        r"(?:no\.?\s*referensi|referensi|ref\.?\s*(?:no|id)?|id\s*transaksi|no\.?\s*transaksi)[:\s#]*([A-Za-z0-9\-_/]{4,})",
        text,
        re.IGNORECASE,
    )
    if ref_match:
        ref_number = ref_match.group(1).strip()

    notes_parts: List[str] = []
    if creditor_hint:
        notes_parts.append(f"Pembayaran {creditor_hint}")
    if ref_number:
        notes_parts.append(f"Ref: {ref_number}")

    amt_conf = 0.9 if amount > 0 else 0.35
    date_conf = 0.88 if payment_date else 0.45
    acc_conf = 0.82 if source_account_hint else 0.4
    overall_confidence = round((amt_conf + date_conf + acc_conf) / 3, 2)

    return {
        "mode": "payment",
        "engine": engine,
        "extraction_method": extraction_method,
        "raw_text": text,
        "parsed_payment": {
            "amount": float(amount),
            "payment_date": payment_date,
            "source_account_hint": source_account_hint,
            "creditor_hint": creditor_hint,
            "reference_number": ref_number,
            "notes": " | ".join(notes_parts),
        },
        "confidence_scores": {
            "amount": amt_conf,
            "payment_date": date_conf,
            "source_account_hint": acc_conf,
        },
        "overall_confidence": overall_confidence,
        "needs_review": overall_confidence < 0.7 or amount <= 0,
        "warnings": warnings,
    }


async def parse_debt_payment(
    file_bytes: bytes,
    filename: str = "",
    pdf_password: Optional[str] = None,
    provider: str = "local",
    model_name: str = "default",
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    source = extract_snapshot_source(file_bytes, filename, pdf_password)
    heuristic = parse_debt_payment_heuristic(
        source["raw_text"],
        engine=source["engine"],
        extraction_method=source["extraction_method"],
    )

    if api_key and provider and provider != "local":
        prompt = (
            "You are an expert Indonesian debt payment receipt parser (bank transfers, e-wallet receipts, PayLater/CC payment confirmations).\n"
            f"Raw extracted text:\n{source['raw_text']}\n\n"
            "Extract the payment amount, payment date (YYYY-MM-DD), source bank/e-wallet name, creditor/loan paid, and transaction reference.\n"
            "Return ONLY raw JSON:\n"
            "{\n"
            '  "amount": number,\n'
            '  "payment_date": "YYYY-MM-DD",\n'
            '  "source_account_hint": "string",\n'
            '  "creditor_hint": "string",\n'
            '  "reference_number": "string",\n'
            '  "notes": "string"\n'
            "}"
        )
        ai_data = await _call_vision_json(
            prompt,
            source.get("image_base64"),
            source.get("mime_type", "image/png"),
            provider,
            model_name,
            api_key,
        )
        if isinstance(ai_data, dict):
            base = heuristic["parsed_payment"]
            amt = _safe_float(ai_data.get("amount"))
            if amt is None or amt <= 0:
                amt = base["amount"]
            pdate = str(ai_data.get("payment_date") or "").strip()
            if not re.match(r"^20\d{2}-\d{2}-\d{2}$", pdate):
                pdate = base["payment_date"]
            src_hint = str(ai_data.get("source_account_hint") or base["source_account_hint"] or "").strip()
            cred_hint = str(ai_data.get("creditor_hint") or base["creditor_hint"] or "").strip()
            ref_num = str(ai_data.get("reference_number") or base["reference_number"] or "").strip()
            notes = str(ai_data.get("notes") or base["notes"] or "").strip()

            return {
                "mode": "payment",
                "engine": f"ai_vision ({provider})",
                "extraction_method": source["extraction_method"],
                "raw_text": source["raw_text"],
                "parsed_payment": {
                    "amount": float(amt),
                    "payment_date": pdate,
                    "source_account_hint": src_hint,
                    "creditor_hint": cred_hint,
                    "reference_number": ref_num,
                    "notes": notes,
                },
                "confidence_scores": {
                    "amount": 0.95 if amt > 0 else 0.4,
                    "payment_date": 0.92 if pdate else 0.5,
                    "source_account_hint": 0.9 if src_hint else 0.5,
                },
                "overall_confidence": 0.92 if amt > 0 else 0.6,
                "needs_review": amt <= 0,
                "warnings": heuristic["warnings"],
            }

    return heuristic


def parse_account_snapshot_heuristic(
    raw_text: str,
    engine: str = "tesseract (ind+eng)",
    extraction_method: str = "image_ocr",
    pdf_fallback_balance: Optional[float] = None,
    pdf_fallback_bank: str = "",
    pdf_fallback_date: str = "",
) -> Dict[str, Any]:
    lines = [ln.strip() for ln in (raw_text or "").splitlines() if ln.strip()]
    text = "\n".join(lines)
    warnings: List[str] = []

    bank_provider, acc_type = _detect_account_provider(text)
    if not bank_provider and pdf_fallback_bank and pdf_fallback_bank != "Unknown":
        bank_provider = pdf_fallback_bank
        acc_type = _normalize_account_type("bank", bank_provider)

    currency = _detect_currency(text, "IDR")

    balance_kw = (
        r"saldo\s*akhir|ending\s*balance|closing\s*balance|saldo\s*efektif|"
        r"saldo\s*tersedia|total\s*saldo|saldo\s*aktif|available\s*balance|"
        r"saldo\s*rekening|total\s*portofolio|nilai\s*portofolio|saldo"
    )
    balance = _extract_amount_from_lines_or_next(lines, balance_kw)
    if balance is None and pdf_fallback_balance is not None and pdf_fallback_balance > 0:
        balance = float(pdf_fallback_balance)
        warnings.append("Saldo akhir diambil dari baris mutasi terakhir pada PDF.")

    if balance is None:
        balance = 0.0

    # Account number extraction
    account_number = ""
    acc_num_match = re.search(
        r"(?:no\.?\s*rekening|nomor\s*rekening|account\s*(?:number|no\.?)|no\.?\s*rek\.?|rek\.?)[:\s#]*([*\dxX\- ]{4,24})",
        text,
        re.IGNORECASE,
    )
    if acc_num_match:
        candidate = re.sub(r"[\s\-]", "", acc_num_match.group(1))
        if re.search(r"\d{4}", candidate):
            account_number = candidate
    if not account_number:
        masked_match = re.search(r"(?:\*{2,}|x{2,})(\d{4})\b", text, re.IGNORECASE)
        if masked_match:
            account_number = "****" + masked_match.group(1)

    # Balance date extraction (prefer statement period end date if present)
    balance_date = ""
    period_match = re.search(
        r"periode[:\s]*(?:[\d\w\s/]+\s*(?:-|s/?d|to|hingga)\s*)([\d\w\s\-/]+)",
        text,
        re.IGNORECASE,
    )
    if period_match:
        balance_date = _extract_date_from_text(period_match.group(1))
    if not balance_date:
        balance_date = _extract_date_from_text(text)
    if not balance_date and pdf_fallback_date:
        balance_date = pdf_fallback_date

    if bank_provider:
        suggested_name = (
            f"{bank_provider} ({acc_type == 'deposit' and 'Deposito' or 'Utama'})"
            if acc_type == "deposit"
            else bank_provider
        )
        if account_number and len(account_number) >= 4:
            suggested_name = f"{bank_provider} ••••{account_number[-4:]}"
    else:
        suggested_name = lines[0][:50] if lines else ""

    bal_conf = 0.9 if balance > 0 else 0.35
    prov_conf = 0.9 if bank_provider else 0.45
    num_conf = 0.85 if account_number else 0.5
    overall_confidence = round((bal_conf + prov_conf + num_conf) / 3, 2)

    return {
        "engine": engine,
        "extraction_method": extraction_method,
        "raw_text": text,
        "parsed_account": {
            "name": suggested_name,
            "type": acc_type if acc_type in ALLOWED_ACCOUNT_TYPES else "bank",
            "bank_provider": bank_provider,
            "account_number": account_number,
            "balance": float(balance),
            "balance_date": balance_date,
            "currency": currency if currency in ALLOWED_CURRENCIES else "IDR",
            "notes": "",
        },
        "confidence_scores": {
            "balance": bal_conf,
            "bank_provider": prov_conf,
            "account_number": num_conf,
        },
        "overall_confidence": overall_confidence,
        "needs_review": overall_confidence < 0.7 or balance <= 0,
        "warnings": warnings,
    }


async def parse_account_snapshot(
    file_bytes: bytes,
    filename: str = "",
    pdf_password: Optional[str] = None,
    provider: str = "local",
    model_name: str = "default",
    api_key: Optional[str] = None,
) -> Dict[str, Any]:
    source = extract_snapshot_source(file_bytes, filename, pdf_password)

    pdf_fallback_balance: Optional[float] = None
    pdf_fallback_bank = ""
    pdf_fallback_date = ""
    if source["is_pdf"]:
        try:
            mutasi = parse_pdf_mutasi(file_bytes, pdf_password=pdf_password)
            pdf_fallback_bank = mutasi.get("bank_detected", "")
            txs = mutasi.get("transactions") or []
            if txs:
                for tx in reversed(txs):
                    if float(tx.get("balance") or 0) > 0:
                        pdf_fallback_balance = float(tx["balance"])
                        pdf_fallback_date = str(tx.get("date") or "")
                        break
        except PDFPasswordError:
            raise
        except Exception:
            pass

    heuristic = parse_account_snapshot_heuristic(
        source["raw_text"],
        engine=source["engine"],
        extraction_method=source["extraction_method"],
        pdf_fallback_balance=pdf_fallback_balance,
        pdf_fallback_bank=pdf_fallback_bank,
        pdf_fallback_date=pdf_fallback_date,
    )

    if api_key and provider and provider != "local":
        prompt = (
            "You are an expert Indonesian banking & e-wallet statement/screenshot parser "
            "(BCA, Mandiri, BNI, BRI, BSI, CIMB Niaga, SeaBank, Bank Jago, Jenius, blu, GoPay, OVO, DANA, ShopeePay, Bibit, Bareksa).\n"
            f"Raw extracted text:\n{source['raw_text']}\n\n"
            "Extract account provider, account type (strictly one of: bank, e_wallet, cash, investment, deposit), "
            "account number (or masked number if visible), current/ending balance, balance date (YYYY-MM-DD), and currency.\n"
            "Return ONLY raw JSON:\n"
            "{\n"
            '  "name": "string",\n'
            '  "type": "bank|e_wallet|cash|investment|deposit",\n'
            '  "bank_provider": "string",\n'
            '  "account_number": "string",\n'
            '  "balance": number,\n'
            '  "balance_date": "YYYY-MM-DD",\n'
            '  "currency": "IDR|USD|SGD|EUR",\n'
            '  "notes": "string"\n'
            "}"
        )
        ai_data = await _call_vision_json(
            prompt,
            source.get("image_base64"),
            source.get("mime_type", "image/png"),
            provider,
            model_name,
            api_key,
        )
        if isinstance(ai_data, dict):
            base = heuristic["parsed_account"]
            bal = _safe_float(ai_data.get("balance"))
            if bal is None:
                bal = base["balance"]
            bank_prov = str(ai_data.get("bank_provider") or base["bank_provider"] or "").strip()
            acc_num = str(ai_data.get("account_number") or base["account_number"] or "").strip()
            name_val = str(ai_data.get("name") or base["name"] or bank_prov).strip()
            acc_type = _normalize_account_type(ai_data.get("type"), f"{bank_prov} {name_val}")
            bdate = str(ai_data.get("balance_date") or "").strip()
            if not re.match(r"^20\d{2}-\d{2}-\d{2}$", bdate):
                bdate = base["balance_date"]
            curr = str(ai_data.get("currency") or base["currency"] or "IDR").upper()
            if curr not in ALLOWED_CURRENCIES:
                curr = "IDR"

            return {
                "engine": f"ai_vision ({provider})",
                "extraction_method": source["extraction_method"],
                "raw_text": source["raw_text"],
                "parsed_account": {
                    "name": name_val,
                    "type": acc_type,
                    "bank_provider": bank_prov,
                    "account_number": acc_num,
                    "balance": float(bal),
                    "balance_date": bdate,
                    "currency": curr,
                    "notes": str(ai_data.get("notes") or base["notes"] or "").strip(),
                },
                "confidence_scores": {
                    "balance": 0.95 if bal > 0 else 0.4,
                    "bank_provider": 0.94 if bank_prov else 0.5,
                    "account_number": 0.9 if acc_num else 0.55,
                },
                "overall_confidence": 0.93 if bal > 0 else 0.65,
                "needs_review": bal <= 0,
                "warnings": heuristic["warnings"],
            }

    return heuristic
