import base64
from datetime import datetime
import html
import re
from typing import Any, Dict, List, Optional

from app.services.pdf_service import (
    _normalize_statement_date,
    detect_bank_format,
    parse_pdf_mutasi,
)


def _strip_html_safely(raw_html: str) -> str:
    if not raw_html:
        return ""
    cleaned = re.sub(r"(?is)<(script|style).*?>.*?</\1>", " ", raw_html)
    cleaned = re.sub(r"(?i)<br\s*/?>|</(p|div|tr|li|h[1-6])>", "\n", cleaned)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = html.unescape(cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    cleaned = re.sub(r"\n{2,}", "\n", cleaned)
    return cleaned.strip()


def _parse_idr_amount(raw: str) -> float:
    clean = re.sub(r"[^0-9.,]", "", (raw or "").strip())
    if not clean:
        return 0.0
    if "," in clean and "." in clean:
        if clean.rfind(",") > clean.rfind("."):
            clean = clean.replace(".", "").replace(",", ".")
        else:
            clean = clean.replace(",", "")
    elif "." in clean:
        parts = clean.split(".")
        if all(len(p) == 3 for p in parts[1:]):
            clean = clean.replace(".", "")
    elif "," in clean:
        parts = clean.split(",")
        if len(parts[-1]) == 2:
            clean = clean.replace(",", ".")
        else:
            clean = clean.replace(",", "")
    try:
        return float(clean)
    except ValueError:
        return 0.0


def _detect_channel(text_lower: str) -> str:
    if "qris tap" in text_lower or "nfc" in text_lower:
        return "QRIS Tap"
    if "qris" in text_lower:
        return "QRIS"
    if "bi-fast" in text_lower or "bifast" in text_lower:
        return "BI-FAST"
    if "kartu kredit" in text_lower or "credit card" in text_lower:
        return "Kartu Kredit"
    return "Transfer"


def _detect_direction_is_credit(text_lower: str) -> bool:
    credit_cues = (
        "transfer masuk",
        "dana masuk",
        "uang masuk",
        "saldo masuk",
        "top up masuk",
        "kredit",
        "penerimaan dana",
        "cashback",
        "gaji",
        "refund",
    )
    debit_cues = (
        "pembayaran",
        "transaksi berhasil",
        "pembelian",
        "debit",
        "tagihan",
        "transfer keluar",
        "berhasil dibayar",
        "qris",
        "bayar",
    )
    if any(c in text_lower for c in credit_cues):
        return True
    if any(d in text_lower for d in debit_cues):
        return False
    return False


def _extract_email_date(text: str) -> str:
    iso_m = re.search(r"\b(20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b", text)
    if iso_m:
        norm = _normalize_statement_date(iso_m.group(1))
        if norm:
            return norm

    word_m = re.search(
        r"\b(\d{1,2}\s+(?:jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|nop|des|dec)[a-z]*\s+20\d{2})\b",
        text,
        re.IGNORECASE,
    )
    if word_m:
        norm = _normalize_statement_date(word_m.group(1))
        if norm:
            return norm

    dmy_m = re.search(r"\b(\d{1,2}[-/]\d{1,2}[-/](?:20)?\d{2})\b", text)
    if dmy_m:
        norm = _normalize_statement_date(dmy_m.group(1))
        if norm:
            return norm

    return datetime.now().strftime("%Y-%m-%d")


def _extract_merchant_hint(text: str, subject: str) -> str:
    m = re.search(
        r"(?:merchant|penerima|ke|kepada|di|tujuan|deskripsi|keterangan)\s*[:\-]\s*([^\n,;]{2,80})",
        text,
        re.IGNORECASE,
    )
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip(" .-")
    clean_subj = re.sub(r"^(fwd?:|re:)\s*", "", (subject or "").strip(), flags=re.IGNORECASE).strip()
    return clean_subj[:80] if clean_subj else "Transaksi Email Forward"


def parse_inbound_email_statement(
    subject: str,
    sender: str,
    body_text: str = "",
    body_html: str = "",
    attachments: Optional[List[Dict[str, Any]]] = None,
    pdf_password: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Parses forwarded Indonesian bank / credit-card / e-wallet statement emails:
    1) PDF e-statement attachments via parse_pdf_mutasi
    2) Notification/alert email bodies (HTML or plain text) into normalized transactions.
    """
    extracted_txs: List[Dict[str, Any]] = []
    detected_bank = "Unknown"

    # 1. Inspect PDF attachments first
    for att in attachments or []:
        if not isinstance(att, dict):
            continue
        fname = str(att.get("filename") or "").strip().lower()
        ctype = str(att.get("content_type") or "").strip().lower()
        b64_data = str(att.get("content_base64") or "").strip()
        if not b64_data:
            continue
        if fname.endswith(".pdf") or ctype == "application/pdf":
            try:
                if "," in b64_data and b64_data.startswith("data:"):
                    b64_data = b64_data.split(",", 1)[1]
                pdf_bytes = base64.b64decode(b64_data)
                pdf_res = parse_pdf_mutasi(pdf_bytes, pdf_password=pdf_password)
                if pdf_res.get("bank_detected") and pdf_res.get("bank_detected") != "Unknown":
                    detected_bank = str(pdf_res["bank_detected"])
                for item in pdf_res.get("transactions") or []:
                    extracted_txs.append(item)
            except Exception:
                continue

    stripped_html = _strip_html_safely(body_html)
    combined_body = "\n".join(part for part in [subject, body_text, stripped_html] if part).strip()

    if detected_bank == "Unknown":
        detected_bank = detect_bank_format(f"{sender}\n{combined_body}")
        if detected_bank == "Unknown" and "kartu kredit" in combined_body.lower():
            detected_bank = "Kartu Kredit"
        elif detected_bank == "Unknown" and "dana" in f"{sender} {subject}".lower():
            detected_bank = "DANA"

    # 2. If no PDF rows were extracted, parse notification lines or email body amount
    if not extracted_txs and combined_body:
        amount_pattern = re.compile(r"(?:rp\.?|idr)\s*([\d.,]+)", re.IGNORECASE)
        fallback_date = _extract_email_date(combined_body)
        default_channel = _detect_channel(combined_body.lower())

        lines = [ln.strip() for ln in combined_body.splitlines() if ln.strip()]
        seen_signatures = set()
        # Look for structured multi-item lines first ("2026-11-21 Merchant - Rp 45.000")
        for ln in lines:
            m_amt = amount_pattern.search(ln)
            if not m_amt:
                continue
            val = _parse_idr_amount(m_amt.group(1))
            if val <= 0:
                continue
            line_low = ln.lower()
            # Skip pure balance summary lines when a real transaction cue isn't present
            if ("saldo akhir" in line_low or "sisa saldo" in line_low or "limit tersisa" in line_low) and not any(
                k in line_low for k in ("pembayaran", "transaksi", "pembelian", "transfer", "qris", "nominal")
            ):
                continue

            is_credit = _detect_direction_is_credit(f"{subject.lower()} {line_low}")
            tx_date = _extract_email_date(ln) if re.search(r"\d{2,4}[-/]\d{1,2}|\b20\d{2}\b", ln) else fallback_date
            desc_clean = amount_pattern.sub("", ln).strip(" :-|•")
            desc_clean = re.sub(r"\s+", " ", desc_clean).strip()
            if len(desc_clean) < 4 or re.match(
                r"^(nominal|jumlah|total|tagihan|pembayaran|amount)\b", desc_clean, re.IGNORECASE
            ):
                desc_clean = _extract_merchant_hint(combined_body, subject)

            sig = (tx_date, round(val), is_credit)
            if sig in seen_signatures:
                continue
            seen_signatures.add(sig)

            extracted_txs.append(
                {
                    "date": tx_date,
                    "description": desc_clean[:120],
                    "debit": 0.0 if is_credit else val,
                    "credit": val if is_credit else 0.0,
                    "balance": 0.0,
                    "channel": _detect_channel(line_low) if "qris" in line_low or "bi-fast" in line_low else default_channel,
                    "bank": detected_bank,
                }
            )

    return {
        "source": "email_forward",
        "bank": detected_bank,
        "subject": subject,
        "sender": sender,
        "parsed_count": len(extracted_txs),
        "transactions": extracted_txs,
    }
