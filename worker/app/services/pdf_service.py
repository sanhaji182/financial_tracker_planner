import io
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import pdfplumber
import pytesseract

from app.services.ocr_service import (
    PDFPasswordError,
    get_tesseract_lang,
    is_pdf_password_error,
    parse_receipt_text,
    preprocess_image_variants,
    raise_pdf_password_error,
)

try:
    from pdf2image import convert_from_bytes
except ImportError:
    convert_from_bytes = None


def detect_bank_format(first_page_text: str) -> str:
    """
    Detects Indonesian bank format based on keywords in extracted statement text.
    """
    text = first_page_text.upper()
    bank_keywords = [
        ("Blu by BCA Digital", ("BLU BY BCA", "BCA DIGITAL")),
        ("BCA", ("BCA", "BANK CENTRAL ASIA")),
        ("Mandiri", ("MANDIRI", "BANK MANDIRI")),
        ("BNI", ("BNI", "BANK NEGARA INDONESIA")),
        ("BRI", ("BRI", "BANK RAKYAT INDONESIA")),
        ("BSI", ("BSI", "BANK SYARIAH INDONESIA")),
        ("CIMB Niaga", ("CIMB", "CIMB NIAGA")),
        ("Permata", ("PERMATA BANK", "PERMATABANK")),
        ("Danamon", ("DANAMON",)),
        ("Bank Jago", ("BANK JAGO", "PT BANK JAGO", "KANTONG JAGO", "BY JAGO")),
        ("SeaBank", ("SEABANK", "PT BANK SEABANK")),
        ("Jenius", ("JENIUS", "BTPN", "SMBC INDONESIA")),
        ("GoPay", ("GOPAY", "DOMPET ANAK BANGSA")),
        ("ShopeePay", ("SHOPEEPAY", "AIRPAY INTERNATIONAL")),
        ("OVO", ("OVO", "PT VISIONET INTERNASIONAL")),
        ("OCBC", ("OCBC",)),
    ]
    for bank_name, keywords in bank_keywords:
        if any(kw in text for kw in keywords):
            return bank_name
    return "Unknown"


_ID_MONTH_MAP = {
    "jan": "01",
    "feb": "02",
    "mar": "03",
    "apr": "04",
    "mei": "05",
    "may": "05",
    "jun": "06",
    "jul": "07",
    "agu": "08",
    "agt": "08",
    "aug": "08",
    "sep": "09",
    "okt": "10",
    "oct": "10",
    "nov": "11",
    "nop": "11",
    "des": "12",
    "dec": "12",
}


def _normalize_statement_date(raw_date: str) -> str:
    clean = (raw_date or "").strip()
    if not clean:
        return ""
    m_iso = re.match(r"^(20\d{2})[-/](\d{1,2})[-/](\d{1,2})$", clean)
    if m_iso:
        return f"{m_iso.group(1)}-{int(m_iso.group(2)):02d}-{int(m_iso.group(3)):02d}"

    m_dmy = re.match(r"^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$", clean)
    if m_dmy:
        d, mo, y = m_dmy.groups()
        if len(y) == 2:
            y = "20" + y
        return f"{y}-{int(mo):02d}-{int(d):02d}"

    m_word = re.match(r"^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$", clean)
    if m_word:
        d, mo_word, y = m_word.groups()
        m_num = _ID_MONTH_MAP.get(mo_word.lower()[:3])
        if m_num:
            return f"{y}-{m_num}-{int(d):02d}"
    return ""


def parse_digital_bank_statement(pages, bank: str = "Digital Bank") -> List[Dict[str, Any]]:
    """
    Parser for Indonesian digital banks & e-wallets (Bank Jago Kantong, SeaBank,
    Blu by BCA Digital, BSI, Jenius, GoPay, ShopeePay, OVO).
    Supports both tabular extraction and text lines with 'DD Mon YYYY [HH:MM]'
    or DD/MM/YYYY prefixes and signed Rp amounts (+/-) or Masuk/Keluar columns.
    """
    transactions: List[Dict[str, Any]] = []
    date_prefix_re = (
        r"(\d{1,2}\s+(?:jan|feb|mar|apr|mei|may|jun|jul|agu|agt|aug|sep|okt|oct|nov|nop|des|dec)[a-z]*\s+20\d{2}"
        r"|20\d{2}[-/]\d{1,2}[-/]\d{1,2}"
        r"|\d{1,2}[-/]\d{1,2}[-/]\d{2,4})"
    )
    line_re = re.compile(
        rf"^{date_prefix_re}(?:\s+\d{{1,2}}[:.]\d{{2}}(?::\d{{2}})?)?\s+(.*?)\s+"
        rf"([+-]?\s*(?:[Rr]p\.?\s*|IDR\s*)?[\d.,]+)\s*(Masuk|Keluar|CR|DB|DR)?(?:\s+(?:[Rr]p\.?\s*)?([\d.,]+))?$",
        re.IGNORECASE,
    )

    for page in pages:
        table = page.extract_table()
        if table:
            for row in table:
                if not row or len(row) < 3:
                    continue
                date_str = _normalize_statement_date((row[0] or "").splitlines()[0])
                if not date_str:
                    continue
                desc = (row[1] or "").replace("\n", " ").strip()
                cells = [str(c or "").strip() for c in row[2:]]
                debit = 0.0
                credit = 0.0
                bal = 0.0
                # Handle separate Masuk / Keluar columns vs single signed amount column
                if len(cells) >= 3 and (
                    re.search(r"[\d.,]{3,}", cells[0]) or re.search(r"[\d.,]{3,}", cells[1])
                ):
                    c0 = clean_pdf_amount(cells[0])
                    c1 = clean_pdf_amount(cells[1])
                    # Determine debit vs credit using sign or column header heuristic (Masuk/Keluar)
                    if c0 < 0 or c1 < 0:
                        for v in (c0, c1):
                            if v < 0:
                                debit = abs(v)
                            elif v > 0:
                                credit = v
                    else:
                        credit = abs(c0)
                        debit = abs(c1)
                    bal = abs(clean_pdf_amount(cells[-1]))
                else:
                    amt_raw = cells[0] if cells else "0"
                    bal_raw = cells[-1] if len(cells) >= 2 else "0"
                    val = clean_pdf_amount(amt_raw)
                    bal = abs(clean_pdf_amount(bal_raw))
                    upper_desc = desc.upper()
                    upper_amt = amt_raw.upper()
                    if val < 0 or "-" in amt_raw or "KELUAR" in upper_amt or "DB" in upper_amt or "QRIS" in upper_desc or "PEMBAYARAN" in upper_desc:
                        debit = abs(val)
                    else:
                        credit = abs(val)
                if debit == 0.0 and credit == 0.0:
                    continue
                transactions.append(
                    {
                        "date": date_str,
                        "description": desc or f"Mutasi {bank}",
                        "debit": debit,
                        "credit": credit,
                        "balance": bal,
                    }
                )
            if transactions:
                continue

        text = page.extract_text() or ""
        for raw_line in text.split("\n"):
            line = re.sub(r"\s+", " ", raw_line).strip()
            if not line:
                continue
            m = line_re.match(line)
            if not m:
                continue
            raw_dt, desc, raw_amt, indicator, raw_bal = m.groups()
            date_str = _normalize_statement_date(raw_dt)
            if not date_str:
                continue
            amt = clean_pdf_amount(raw_amt)
            if amt == 0.0:
                continue
            bal = abs(clean_pdf_amount(raw_bal or "0"))
            ind_up = (indicator or "").upper()
            raw_amt_up = raw_amt.upper()
            is_outgoing = (
                amt < 0
                or raw_amt.lstrip().startswith("-")
                or ind_up in ("KELUAR", "DB", "DR")
                or "KELUAR" in raw_amt_up
                or "DB" in desc.upper()
            )
            transactions.append(
                {
                    "date": date_str,
                    "description": desc.strip(),
                    "debit": abs(amt) if is_outgoing else 0.0,
                    "credit": 0.0 if is_outgoing else abs(amt),
                    "balance": bal,
                }
            )

    return transactions


def annotate_internal_transfers(
    transactions: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], int]:
    """
    Marks rows that are likely internal transfers / e-wallet top-ups or exact same-day
    opposite-direction duplicates so users can exclude double-counting during import.
    """
    transfer_keywords = (
        r"\b(top\s*up|topup|isi\s*saldo|transfer\s*(?:ke|dari)\s*(?:kantong|pocket|rekening\s*sendiri|tabungan)|"
        r"pindah\s*(?:dana|saldo|kantong)|switch(?:ing)?\s*rekening|tarik\s*tunai|atm\s*withdrawal|"
        r"(?:ke|dari)\s*(?:gopay|ovo|dana|shopeepay|linkaja|seabank|jago|blu|jenius))\b"
    )
    transfer_re = re.compile(transfer_keywords, re.IGNORECASE)

    # Index amount pairs (date, rounded_amount) for opposite direction matches
    by_day_amount: Dict[Tuple[str, int], List[Tuple[int, str]]] = {}
    for idx, tx in enumerate(transactions):
        amt = int(round(tx.get("debit") or tx.get("credit") or 0))
        if amt <= 0:
            continue
        direction = "debit" if (tx.get("debit") or 0) > 0 else "credit"
        key = (str(tx.get("date") or ""), amt)
        by_day_amount.setdefault(key, []).append((idx, direction))

    matched_pair_idxs = set()
    for items in by_day_amount.values():
        dirs = {d for _, d in items}
        if "debit" in dirs and "credit" in dirs:
            for idx, _ in items:
                matched_pair_idxs.add(idx)

    annotated: List[Dict[str, Any]] = []
    candidates_count = 0
    for idx, tx in enumerate(transactions):
        copy_tx = dict(tx)
        desc = str(tx.get("description") or "")
        hint = ""
        if idx in matched_pair_idxs:
            hint = "Pasangan debit & kredit bernominal sama di hari yang sama (potensi pindah dana)"
        elif transfer_re.search(desc):
            hint = "Terdeteksi kata kunci top-up e-wallet / pindah rekening"

        if hint:
            copy_tx["possible_transfer"] = True
            copy_tx["transfer_hint"] = hint
            candidates_count += 1
        annotated.append(copy_tx)

    return annotated, candidates_count


def clean_pdf_amount(val_str: str) -> float:
    """
    Cleans amount string from PDF tables/lines and parses to float.
    Handles parentheses for negative and CR/DR/DB suffixes.
    """
    if not val_str:
        return 0.0

    cleaned = val_str.strip()
    is_negative = False

    if cleaned.startswith("(") and cleaned.endswith(")"):
        is_negative = True
        cleaned = cleaned[1:-1]

    if cleaned.upper().endswith(("CR", "DB", "DR")):
        cleaned = cleaned[:-2].strip()

    cleaned = re.sub(r"[Rr]p\.?|\s+", "", cleaned)
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
        val = float(cleaned)
        return -val if is_negative else val
    except ValueError:
        return 0.0


def parse_bca_statement(pages) -> List[Dict[str, Any]]:
    """
    BCA Statement PDF parser.
    """
    transactions: List[Dict[str, Any]] = []
    current_year = datetime.now().year

    for page in pages:
        table = page.extract_table()
        if not table:
            text = page.extract_text()
            if text:
                for line in text.split("\n"):
                    match = re.search(
                        r"^(\d{2})/(\d{2})\s+(.*?)\s+([\d.,]+)\s*(DB|DR|CR)?\s+([\d.,]+)$",
                        line.strip(),
                    )
                    if match:
                        d, m, desc, amt_str, indicator, bal_str = match.groups()
                        amt = clean_pdf_amount(amt_str)
                        bal = clean_pdf_amount(bal_str)
                        debit, credit = 0.0, 0.0
                        if indicator in ("DB", "DR") or "DB" in desc.upper():
                            debit = abs(amt)
                        else:
                            credit = abs(amt)

                        transactions.append(
                            {
                                "date": f"{current_year}-{m}-{d}",
                                "description": desc.strip(),
                                "debit": debit,
                                "credit": credit,
                                "balance": bal,
                            }
                        )
            continue

        for row in table:
            if not row or len(row) < 4:
                continue

            tgl_col = row[0]
            if tgl_col and re.match(r"^\d{2}/\d{2}$", tgl_col.strip()):
                d, m = tgl_col.strip().split("/")
                date_str = f"{current_year}-{m}-{d}"

                desc = row[1] or ""
                mut_str = row[-2] or "0"
                bal_str = row[-1] or "0"

                amt = clean_pdf_amount(mut_str)
                bal = clean_pdf_amount(bal_str)

                debit, credit = 0.0, 0.0
                if "DB" in mut_str or "DB" in desc.upper() or amt < 0:
                    debit = abs(amt)
                else:
                    credit = amt

                transactions.append(
                    {
                        "date": date_str,
                        "description": desc.replace("\n", " ").strip(),
                        "debit": debit,
                        "credit": credit,
                        "balance": bal,
                    }
                )

    return transactions


def parse_mandiri_statement(pages) -> List[Dict[str, Any]]:
    """
    Mandiri/BNI/BRI Statement PDF table parser.
    """
    transactions: List[Dict[str, Any]] = []

    for page in pages:
        table = page.extract_table()
        if not table:
            continue

        for row in table:
            if not row or len(row) < 4:
                continue

            tgl_col = row[0]
            if tgl_col and re.match(
                r"^\d{2}/\d{2}/\d{2,4}$|^\d{2}-\d{2}-\d{2,4}$", tgl_col.strip()
            ):
                clean_tgl = tgl_col.strip().replace("-", "/")
                parts = clean_tgl.split("/")
                if len(parts[2]) == 2:
                    parts[2] = "20" + parts[2]
                date_str = f"{parts[2]}-{parts[1]}-{parts[0]}"

                desc = row[1] or ""
                deb_str = row[2] or "0"
                crd_str = row[3] or "0"
                bal_str = row[4] or "0" if len(row) > 4 else "0"

                transactions.append(
                    {
                        "date": date_str,
                        "description": desc.replace("\n", " ").strip(),
                        "debit": clean_pdf_amount(deb_str),
                        "credit": clean_pdf_amount(crd_str),
                        "balance": clean_pdf_amount(bal_str),
                    }
                )

    return transactions


def parse_ocr_statement_lines(ocr_text: str) -> List[Dict[str, Any]]:
    """
    Extracts statement transaction lines from OCR text of scanned bank statements.
    Supports DD/MM, DD/MM/YYYY, DD-MM-YYYY, and YYYY-MM-DD prefixes.
    """
    transactions: List[Dict[str, Any]] = []
    current_year = datetime.now().year

    for raw_line in ocr_text.split("\n"):
        line = raw_line.strip()
        if not line:
            continue

        # Match YYYY-MM-DD desc amount [DB|CR] [balance]
        m_iso = re.match(
            r"^(20\d{2})[-/](\d{2})[-/](\d{2})\s+(.*?)\s+([+-]?(?:[Rr]p\.?\s*)?[\d.,]{3,})\s*(DB|DR|CR)?(?:\s+([\d.,]{3,}))?$",
            line,
            re.IGNORECASE,
        )
        # Match DD/MM/YYYY or DD-MM-YYYY desc amount [DB|CR] [balance]
        m_full = re.match(
            r"^(\d{2})[-/](\d{2})[-/](\d{2,4})\s+(.*?)\s+([+-]?(?:[Rr]p\.?\s*)?[\d.,]{3,})\s*(DB|DR|CR)?(?:\s+([\d.,]{3,}))?$",
            line,
            re.IGNORECASE,
        )
        # Match DD/MM desc amount [DB|CR] balance
        m_short = re.match(
            r"^(\d{2})/(\d{2})\s+(.*?)\s+([+-]?(?:[Rr]p\.?\s*)?[\d.,]{3,})\s*(DB|DR|CR)?\s+([\d.,]{3,})$",
            line,
            re.IGNORECASE,
        )

        date_str = ""
        desc = ""
        amt_str = ""
        indicator = ""
        bal_str = "0"

        if m_iso:
            y, mo, d, desc, amt_str, indicator, bal_opt = m_iso.groups()
            date_str = f"{y}-{mo}-{d}"
            bal_str = bal_opt or "0"
        elif m_full:
            d, mo, y, desc, amt_str, indicator, bal_opt = m_full.groups()
            if len(y) == 2:
                y = "20" + y
            date_str = f"{y}-{mo}-{d}"
            bal_str = bal_opt or "0"
        elif m_short:
            d, mo, desc, amt_str, indicator, bal_str = m_short.groups()
            date_str = f"{current_year}-{mo}-{d}"
        else:
            continue

        amt = clean_pdf_amount(amt_str)
        if amt == 0.0:
            continue

        ind_upper = (indicator or "").upper()
        desc_upper = desc.upper()
        debit, credit = 0.0, 0.0
        if (
            amt < 0
            or amt_str.strip().startswith("-")
            or ind_upper in ("DB", "DR")
            or "DB" in desc_upper
            or "DEBIT" in desc_upper
        ):
            debit = abs(amt)
        else:
            credit = abs(amt)

        transactions.append(
            {
                "date": date_str,
                "description": desc.strip(),
                "debit": debit,
                "credit": credit,
                "balance": clean_pdf_amount(bal_str),
            }
        )

    return transactions


def parse_pdf_mutasi(
    file_bytes: bytes, pdf_password: Optional[str] = None
) -> Dict[str, Any]:
    """
    Main entrypoint to parse bank statement tables/text from digital PDFs,
    automatically falling back to Poppler + Tesseract OCR for scanned PDFs.
    """
    pdf_file = io.BytesIO(file_bytes)
    extraction_method = "digital_pdf"

    try:
        pdf_ctx = pdfplumber.open(pdf_file, password=pdf_password or None)
    except Exception as exc:
        if is_pdf_password_error(exc):
            raise_pdf_password_error(pdf_password)
        raise

    with pdf_ctx as pdf:
        if not pdf.pages:
            return {
                "bank_detected": "Unknown",
                "period": "",
                "transactions": [],
                "confidence": 0.0,
                "extraction_method": extraction_method,
            }

        page_texts = [p.extract_text() or "" for p in pdf.pages]
        first_page_text = page_texts[0]
        combined_text = "\n".join(page_texts).strip()
        bank = detect_bank_format(first_page_text or combined_text)

        period = ""
        period_match = re.search(
            r"periode[:\s]*([\d\w\s\-/]+)", combined_text, re.IGNORECASE
        )
        if period_match:
            period = period_match.group(1).strip().split("\n")[0]

        transactions: List[Dict[str, Any]] = []
        digital_banks = (
            "Bank Jago",
            "SeaBank",
            "Blu by BCA Digital",
            "BSI",
            "Jenius",
            "GoPay",
            "ShopeePay",
            "OVO",
        )
        if len(combined_text) >= 20:
            if bank == "BCA":
                transactions = parse_bca_statement(pdf.pages)
            elif bank in ("Mandiri", "BNI", "BRI"):
                transactions = parse_mandiri_statement(pdf.pages)
            elif bank in digital_banks:
                transactions = parse_digital_bank_statement(pdf.pages, bank=bank)
            else:
                transactions = parse_bca_statement(pdf.pages)
                if not transactions:
                    transactions = parse_mandiri_statement(pdf.pages)
                if not transactions:
                    transactions = parse_digital_bank_statement(pdf.pages, bank=bank)

        # Fallback to OCR if digital text is empty/minimal (scanned PDF) or digital parsing found nothing
        if (len(combined_text) < 40 or not transactions) and convert_from_bytes is not None:
            try:
                lang = get_tesseract_lang()
                convert_kwargs: Dict[str, Any] = {"dpi": 200, "first_page": 1, "last_page": 10}
                if pdf_password:
                    convert_kwargs["userpw"] = pdf_password
                images = convert_from_bytes(file_bytes, **convert_kwargs)
                ocr_texts: List[str] = []
                for img in images:
                    img_buf = io.BytesIO()
                    img.save(img_buf, format="PNG")
                    variant = preprocess_image_variants(img_buf.getvalue())[0]
                    ocr_texts.append(
                        pytesseract.image_to_string(variant, lang=lang, config="--oem 3 --psm 6")
                    )

                full_ocr_text = "\n".join(ocr_texts).strip()
                if full_ocr_text:
                    extraction_method = "scanned_pdf_ocr"
                    if bank == "Unknown":
                        bank = detect_bank_format(full_ocr_text)
                    if not period:
                        pm = re.search(
                            r"periode[:\s]*([\d\w\s\-/]+)", full_ocr_text, re.IGNORECASE
                        )
                        if pm:
                            period = pm.group(1).strip().split("\n")[0]

                    ocr_tx = parse_ocr_statement_lines(full_ocr_text)
                    if ocr_tx:
                        transactions = ocr_tx
                    else:
                        # Scanned PDF may be a single receipt/invoice instead of tabular statement
                        receipt_parsed = parse_receipt_text(full_ocr_text, {})
                        rdata = receipt_parsed.get("parsed_data", {})
                        if rdata.get("total", 0) > 0:
                            transactions = [
                                {
                                    "date": rdata.get("date") or datetime.now().strftime("%Y-%m-%d"),
                                    "description": rdata.get("merchant_name") or "Dokumen PDF OCR",
                                    "debit": float(rdata.get("total", 0)),
                                    "credit": 0.0,
                                    "balance": 0.0,
                                }
                            ]
            except PDFPasswordError:
                raise
            except Exception as exc:
                if is_pdf_password_error(exc):
                    raise_pdf_password_error(pdf_password)

        annotated_transactions, transfer_candidates_count = annotate_internal_transfers(transactions)

        if annotated_transactions and extraction_method == "scanned_pdf_ocr":
            confidence = 0.8 if bank != "Unknown" else 0.72
        elif annotated_transactions and bank != "Unknown":
            confidence = 0.9
        elif annotated_transactions:
            confidence = 0.65
        else:
            confidence = 0.3

        return {
            "bank_detected": bank,
            "period": period,
            "transactions": annotated_transactions,
            "confidence": confidence,
            "extraction_method": extraction_method,
            "transfer_candidates_count": transfer_candidates_count,
        }
