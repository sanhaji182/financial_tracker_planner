import io
import re
from typing import Any, Dict, List, Optional

import cv2
import numpy as np
import pdfplumber
from PIL import Image, ImageEnhance, ImageOps
import pytesseract

try:
    from pdf2image import convert_from_bytes
except ImportError:
    convert_from_bytes = None

try:
    from pdfminer.pdfdocument import PDFEncryptionError, PDFPasswordIncorrect
except ImportError:  # pragma: no cover
    PDFEncryptionError = ()  # type: ignore[assignment]
    PDFPasswordIncorrect = ()  # type: ignore[assignment]


class PDFPasswordError(Exception):
    """Raised when a PDF is encrypted and requires a password or the provided password is invalid."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def is_pdf_password_error(exc: Exception) -> bool:
    """Detects whether an exception raised while opening/rendering a PDF is due to encryption/password."""
    if PDFPasswordIncorrect and isinstance(exc, PDFPasswordIncorrect):
        return True
    if PDFEncryptionError and isinstance(exc, PDFEncryptionError):
        return True
    cls_name = type(exc).__name__.lower()
    msg = str(exc).lower()
    return (
        "password" in cls_name
        or "encrypt" in cls_name
        or "password" in msg
        or "encrypted" in msg
    )


def raise_pdf_password_error(pdf_password: Optional[str]) -> None:
    """Raises PDFPasswordError with appropriate code depending on whether a password was supplied."""
    if pdf_password:
        raise PDFPasswordError(
            "PDF_INVALID_PASSWORD",
            "Password PDF salah. Silakan periksa kembali dan coba lagi.",
        )
    raise PDFPasswordError(
        "PDF_PASSWORD_REQUIRED",
        "PDF ini dilindungi password. Masukkan password PDF untuk melanjutkan.",
    )


def get_tesseract_lang() -> str:
    """Returns Indonesian + English language pack when installed, else English."""
    try:
        langs = pytesseract.get_languages(config="")
        if "ind" in langs and "eng" in langs:
            return "ind+eng"
        if "ind" in langs:
            return "ind"
    except Exception:
        pass
    return "eng"


def _rotate_osd_safe(image: Image.Image) -> Image.Image:
    """Attempts coarse orientation correction via Tesseract OSD."""
    try:
        osd = pytesseract.image_to_osd(image)
        angle = re.search(r"Rotate: (\d+)", osd)
        if angle:
            rot_angle = int(angle.group(1))
            if rot_angle in (90, 180, 270):
                return image.rotate(-rot_angle, expand=True)
    except Exception:
        pass
    return image


def _deskew_gray(gray: np.ndarray) -> np.ndarray:
    """Gently deskews a grayscale document image within [-12, 12] degrees."""
    try:
        inv = cv2.bitwise_not(gray)
        _, thresh = cv2.threshold(inv, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        coords = np.column_stack(np.where(thresh > 0))
        if len(coords) < 100:
            return gray

        rect = cv2.minAreaRect(coords)
        angle = rect[-1]
        if angle < -45:
            angle = -(90 + angle)
        else:
            angle = -angle

        if 0.5 < abs(angle) <= 12.0:
            h, w = gray.shape[:2]
            center = (w // 2, h // 2)
            matrix = cv2.getRotationMatrix2D(center, angle, 1.0)
            return cv2.warpAffine(
                gray,
                matrix,
                (w, h),
                flags=cv2.INTER_CUBIC,
                borderMode=cv2.BORDER_REPLICATE,
            )
    except Exception:
        pass
    return gray


def preprocess_image_variants(image_bytes: bytes) -> List[Image.Image]:
    """
    Applies full camera/scan preprocessing and produces two OCR variants:
    1. EXIF-transposed + upscaled/capped + CLAHE grayscale + deskew
    2. Adaptive Gaussian thresholded binary variant for uneven lighting/shadows
    """
    image = Image.open(io.BytesIO(image_bytes))
    image = ImageOps.exif_transpose(image)
    if image.mode != "RGB":
        image = image.convert("RGB")

    width, height = image.size
    if width < 1200:
        scale = min(2.0, 1600.0 / max(1, width))
        target_w = max(1200, int(width * scale))
        target_h = int(height * (target_w / max(1, width)))
        image = image.resize((target_w, target_h), Image.Resampling.LANCZOS)
    elif width > 2400:
        target_w = 2400
        target_h = int(height * (target_w / width))
        image = image.resize((target_w, target_h), Image.Resampling.LANCZOS)

    image = _rotate_osd_safe(image)

    np_rgb = np.array(image)
    gray = cv2.cvtColor(np_rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    deskewed = _deskew_gray(enhanced)

    binary = cv2.adaptiveThreshold(
        deskewed,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY,
        31,
        11,
    )

    return [Image.fromarray(deskewed), Image.fromarray(binary)]


def preprocess_image(image_bytes: bytes) -> Image.Image:
    """Backwards-compatible single-image preprocessing entrypoint."""
    variants = preprocess_image_variants(image_bytes)
    if variants:
        return variants[0]
    image = Image.open(io.BytesIO(image_bytes))
    image = ImageOps.grayscale(image)
    return ImageEnhance.Contrast(image).enhance(2.0)


def extract_confidence_metrics(data_df: Dict[str, List[Any]], target_words: List[str]) -> float:
    """
    Retrieves the average Tesseract confidence level (0.0 - 1.0) for the matched words.
    """
    if not target_words or "text" not in data_df:
        return 0.75

    confidences = []
    texts = data_df["text"]
    confs = data_df.get("conf", [])

    for word in target_words:
        cleaned_word = re.sub(r"[^a-zA-Z0-9]", "", word.lower())
        if not cleaned_word:
            continue
        matched_conf = []
        for t, c in zip(texts, confs):
            if not isinstance(t, str):
                continue
            cleaned_t = re.sub(r"[^a-zA-Z0-9]", "", t.lower())
            if cleaned_word and (cleaned_word in cleaned_t or cleaned_t in cleaned_word):
                try:
                    conf_num = float(c)
                except (TypeError, ValueError):
                    conf_num = -1
                if conf_num >= 0:
                    matched_conf.append(conf_num / 100.0)
        if matched_conf:
            confidences.append(sum(matched_conf) / len(matched_conf))

    if confidences:
        return sum(confidences) / len(confidences)
    return 0.7


def clean_amount(amt_str: str) -> float:
    """
    Cleans amount string by removing currency symbols, dots, commas,
    and converting to float. Handles Indonesian format (Rp 150.000,00 or similar).
    """
    if not amt_str:
        return 0.0

    cleaned = re.sub(r"[Rr]p\.?|IDR|[\$€]", "", amt_str).strip()

    if "," in cleaned and "." in cleaned:
        if cleaned.find(",") > cleaned.find("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        parts = cleaned.split(",")
        if len(parts[-1]) == 2:
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "." in cleaned:
        parts = cleaned.split(".")
        if len(parts[-1]) == 3:
            cleaned = cleaned.replace(".", "")

    cleaned = re.sub(r"[^0-9.]", "", cleaned)
    try:
        return float(cleaned)
    except ValueError:
        return 0.0


def parse_receipt_text(text: str, data_df: Dict[str, List[Any]]) -> Dict[str, Any]:
    """
    Heuristically parses merchant name, date, total, items, and payment method from receipt OCR text.
    """
    lines = [line.strip() for line in text.split("\n") if line.strip()]

    # 1. Extract Merchant Name from top lines
    merchant_name = "Merchant Unknown"
    merchant_conf = 0.5
    for line in lines[:4]:
        if (
            not re.search(
                r"\d{4}|\d{2}[-/.]\d{2}|telp|phone|npwp|jalan|jl\.|struk|nota",
                line,
                re.IGNORECASE,
            )
            and len(line) > 2
        ):
            candidate = re.sub(r"^[\*\-\#\s:=]+|[\*\-\#\s:=]+$", "", line)
            if len(candidate) > 2:
                merchant_name = candidate
                merchant_conf = extract_confidence_metrics(data_df, merchant_name.split())
                break

    # 2. Extract Date (YYYY-MM-DD, DD/MM/YYYY, or DD Mon YYYY)
    date_str = ""
    date_conf = 0.0

    iso_match = re.search(r"\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b", text)
    if iso_match:
        y, m, d = iso_match.groups()
        if 1 <= int(m) <= 12 and 1 <= int(d) <= 31:
            date_str = f"{y}-{int(m):02d}-{int(d):02d}"
            date_conf = extract_confidence_metrics(data_df, [iso_match.group(0)])

    if not date_str:
        date_match = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b", text)
        if date_match:
            d, m, y = date_match.groups()
            if len(y) == 2:
                y = "20" + y
            if 1 <= int(m) <= 12 and 1 <= int(d) <= 31:
                date_str = f"{y}-{int(m):02d}-{int(d):02d}"
                date_conf = extract_confidence_metrics(data_df, [date_match.group(0)])

    if not date_str:
        months_regex = r"(jan|feb|mar|apr|mei|may|jun|jul|agu|aug|sep|okt|oct|nov|des|dec)[a-z]*"
        date_word_pattern = rf"\b(\d{{1,2}})\s+({months_regex})\s+(\d{{4}})\b"
        date_word_match = re.search(date_word_pattern, text, re.IGNORECASE)
        if date_word_match:
            d_w, m_w, _, y_w = date_word_match.groups()
            months_map = {
                "jan": "01",
                "feb": "02",
                "mar": "03",
                "apr": "04",
                "mei": "05",
                "may": "05",
                "jun": "06",
                "jul": "07",
                "agu": "08",
                "aug": "08",
                "sep": "09",
                "okt": "10",
                "oct": "10",
                "nov": "11",
                "des": "12",
                "dec": "12",
            }
            m_num = months_map.get(m_w.lower()[:3], "01")
            if 1 <= int(d_w) <= 31:
                date_str = f"{y_w}-{m_num}-{int(d_w):02d}"
                date_conf = extract_confidence_metrics(data_df, [date_word_match.group(0)])

    # 3. Extract Total Amount (prioritize Grand Total / Total Bayar; exclude change/subtotal/tax lines)
    total_val = 0.0
    total_conf = 0.0

    exclude_total_line = r"\b(sub\s*total|subtotal|kembali(?:an)?|change|diskon|discount|hemat|potongan|ppn|tax|pajak)\b"
    primary_total_kw = r"grand\s*total|total\s*bayar|total\s*belanja|total\s*tagihan|jumlah\s*bayar|total\s*pembayaran|net\s*amount|netto|total"
    fallback_total_kw = r"jumlah|bayar|tunai|cash|qris"

    primary_pattern = rf"(?:{primary_total_kw})[:\s]*(?:[Rr]p\.?\s*|IDR\s*)?([\d.,\s]+)"
    fallback_pattern = rf"(?:{fallback_total_kw})[:\s]*(?:[Rr]p\.?\s*|IDR\s*)?([\d.,\s]+)"

    for line in reversed(lines):
        if re.search(exclude_total_line, line, re.IGNORECASE):
            continue
        m = re.search(primary_pattern, line, re.IGNORECASE)
        if m:
            amt_str = m.group(1).strip()
            if re.search(r"\d", amt_str):
                cleaned = clean_amount(amt_str)
                if cleaned > 0:
                    total_val = cleaned
                    total_conf = extract_confidence_metrics(data_df, line.split())
                    break

    if total_val == 0.0:
        for line in reversed(lines):
            if re.search(exclude_total_line, line, re.IGNORECASE):
                continue
            m = re.search(fallback_pattern, line, re.IGNORECASE)
            if m:
                amt_str = m.group(1).strip()
                if re.search(r"\d", amt_str):
                    cleaned = clean_amount(amt_str)
                    if cleaned > total_val:
                        total_val = cleaned
                        total_conf = extract_confidence_metrics(data_df, line.split())

    if total_val == 0.0:
        nums = re.findall(r"(?:[Rr]p\.?\s*)?([\d.,]{4,})\b", text)
        for num in nums:
            cleaned = clean_amount(num)
            if cleaned > total_val:
                total_val = cleaned
                total_conf = 0.4

    # 4. Extract Payment Method
    payment_method = "cash"
    pay_conf = 0.5
    pay_patterns = [
        ("qris", r"\bqris\b"),
        ("gopay", r"gopay|go-pay"),
        ("ovo", r"\bovo\b"),
        ("dana", r"\bdana\b"),
        ("shopeepay", r"shopeepay|spay"),
        ("credit_card", r"credit\s*card|kartu\s*kredit|\bvisa\b|\bmastercard\b"),
        ("debit_card", r"debit|kartu\s*debit|\bbca\b|\bmandiri\b|\bbri\b|\bbni\b"),
        ("transfer", r"\btransfer\b|\bva\b|virtual\s*account"),
        ("cash", r"cash|tunai|kembalian|kembali"),
    ]
    for method, pattern in pay_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            payment_method = method
            pay_conf = extract_confidence_metrics(data_df, [m.group(0)])
            break

    # 5. Extract Items List
    items: List[Dict[str, Any]] = []
    skip_item_line = (
        r"\b(total|grand\s*total|subtotal|sub\s*total|kembali(?:an)?|change|"
        r"diskon|discount|ppn|tax|pajak|tunai|cash|qris|debit|kredit|transfer)\b"
    )
    qty_item_pattern = r"^(.*?)\s+(\d+)\s*[xX\*]\s*(?:[Rr]p\.?\s*)?([\d.,\s]+)$"
    for line in lines:
        if re.search(skip_item_line, line, re.IGNORECASE):
            continue
        match = re.search(qty_item_pattern, line)
        if match:
            item_name = re.sub(r"^[\*\-\#\s.]+|[\*\-\#\s.]+$", "", match.group(1).strip())
            qty = int(match.group(2))
            price = clean_amount(match.group(3))
            if len(item_name) > 1 and qty > 0 and price > 0:
                items.append(
                    {
                        "name": item_name,
                        "quantity": qty,
                        "price": price,
                        "total": qty * price,
                    }
                )

    if not items:
        single_pattern = r"^([a-zA-Z0-9\s\-&/().]+?)\s+(?:[Rr]p\.?\s*)?([\d.,]{4,})$"
        for line in lines:
            if re.search(skip_item_line, line, re.IGNORECASE):
                continue
            if re.search(r"\d{2}[-/.]\d{2}[-/.]\d{2,4}|\d{2}:\d{2}", line):
                continue
            single_match = re.search(single_pattern, line)
            if single_match:
                item_name = re.sub(r"^[\*\-\#\s.]+|[\*\-\#\s.]+$", "", single_match.group(1).strip())
                price = clean_amount(single_match.group(2))
                if len(item_name) > 2 and price > 0 and price != total_val:
                    items.append(
                        {
                            "name": item_name,
                            "quantity": 1,
                            "price": price,
                            "total": price,
                        }
                    )

    valid_scores = [s for s in [merchant_conf, date_conf, total_conf, pay_conf] if s > 0]
    overall_confidence = sum(valid_scores) / len(valid_scores) if valid_scores else 0.5
    overall_confidence = max(0.0, min(1.0, overall_confidence))

    needs_review = overall_confidence < 0.7 or not date_str or total_val == 0.0

    confidence_map = {
        "merchant_name": round(merchant_conf, 2),
        "date": round(date_conf, 2),
        "total": round(total_conf, 2),
        "payment_method": round(pay_conf, 2),
    }

    return {
        "parsed_data": {
            "merchant_name": merchant_name,
            "date": date_str,
            "items": items,
            "total": total_val,
            "payment_method": payment_method,
        },
        "confidence_scores": confidence_map,
        "overall_confidence": round(overall_confidence, 2),
        "needs_review": needs_review,
    }


def _score_candidate(parsed: Dict[str, Any]) -> float:
    data = parsed.get("parsed_data", {})
    score = float(parsed.get("overall_confidence", 0.0))
    if data.get("total", 0) > 0:
        score += 0.25
    if data.get("date"):
        score += 0.15
    if data.get("items"):
        score += 0.05
    return score


def process_ocr_receipt(image_bytes: bytes) -> Dict[str, Any]:
    """
    Runs multi-variant preprocessing + Tesseract (ind+eng) and chooses the highest-quality parse.
    """
    lang = get_tesseract_lang()
    tesseract_config = "--oem 3 --psm 6"
    variants = preprocess_image_variants(image_bytes)

    best_result: Dict[str, Any] | None = None
    best_raw_text = ""
    best_score = -1.0

    for variant in variants:
        raw_text = pytesseract.image_to_string(variant, lang=lang, config=tesseract_config)
        try:
            data_df = pytesseract.image_to_data(
                variant,
                lang=lang,
                config=tesseract_config,
                output_type=pytesseract.Output.DICT,
            )
        except Exception:
            data_df = {}

        parsed = parse_receipt_text(raw_text, data_df)
        candidate_score = _score_candidate(parsed)
        if best_result is None or candidate_score > best_score:
            best_score = candidate_score
            best_result = parsed
            best_raw_text = raw_text

    if best_result is None:
        best_result = parse_receipt_text("", {})

    best_result["raw_text"] = best_raw_text.strip()
    best_result["engine"] = f"tesseract ({lang})"
    return best_result


def extract_document_text(
    file_bytes: bytes, filename: str = "", pdf_password: Optional[str] = None
) -> Dict[str, Any]:
    """
    General-purpose full OCR text extractor for images or PDF documents (digital or scanned).
    """
    lang = get_tesseract_lang()
    tesseract_config = "--oem 3 --psm 6"
    is_pdf = filename.lower().endswith(".pdf") or file_bytes[:4] == b"%PDF"

    if not is_pdf:
        variants = preprocess_image_variants(file_bytes)
        text = pytesseract.image_to_string(variants[0], lang=lang, config=tesseract_config)
        return {
            "text": text.strip(),
            "engine": f"tesseract ({lang})",
            "method": "image_ocr",
            "pages": 1,
        }

    digital_chunks: List[str] = []
    page_count = 0
    try:
        with pdfplumber.open(io.BytesIO(file_bytes), password=pdf_password or None) as pdf:
            page_count = len(pdf.pages)
            for page in pdf.pages:
                digital_chunks.append(page.extract_text() or "")
    except Exception as exc:
        if is_pdf_password_error(exc):
            raise_pdf_password_error(pdf_password)
        raise

    digital_text = "\n\n".join(c for c in digital_chunks if c.strip()).strip()
    if len(digital_text) >= 40:
        return {
            "text": digital_text,
            "engine": "pdfplumber",
            "method": "digital_pdf",
            "pages": page_count,
        }

    if convert_from_bytes is None:
        return {
            "text": digital_text,
            "engine": "pdfplumber",
            "method": "digital_pdf",
            "pages": page_count,
        }

    convert_kwargs: Dict[str, Any] = {"dpi": 200, "first_page": 1, "last_page": 10}
    if pdf_password:
        convert_kwargs["userpw"] = pdf_password

    try:
        images = convert_from_bytes(file_bytes, **convert_kwargs)
    except Exception as exc:
        if is_pdf_password_error(exc):
            raise_pdf_password_error(pdf_password)
        raise

    ocr_chunks: List[str] = []
    for img in images:
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        variant = preprocess_image_variants(buf.getvalue())[0]
        ocr_chunks.append(pytesseract.image_to_string(variant, lang=lang, config=tesseract_config))

    return {
        "text": "\n\n".join(c.strip() for c in ocr_chunks if c.strip()),
        "engine": f"tesseract ({lang})",
        "method": "scanned_pdf_ocr",
        "pages": len(images),
    }
