import re
import io
import pdfplumber
from datetime import datetime
from typing import Dict, Any, List

def detect_bank_format(first_page_text: str) -> str:
    """
    Detects bank format based on text keywords on the first page.
    """
    text = first_page_text.upper()
    if "BCA" in text or "BANK CENTRAL ASIA" in text:
        return "BCA"
    elif "MANDIRI" in text or "BANK MANDIRI" in text:
        return "Mandiri"
    elif "BNI" in text or "BANK NEGARA INDONESIA" in text:
        return "BNI"
    elif "BRI" in text or "BANK RAKYAT INDONESIA" in text:
        return "BRI"
    return "Unknown"

def clean_pdf_amount(val_str: str) -> float:
    """
    Cleans amount string from PDF tables and parses to float.
    Handles parentheses for negative (e.g. (150.000) -> -150000 or credit/debit indicators).
    """
    if not val_str:
        return 0.0
    
    cleaned = val_str.strip()
    is_negative = False
    
    # Check parentheses e.g. (150.000)
    if cleaned.startswith("(") and cleaned.endswith(")"):
        is_negative = True
        cleaned = cleaned[1:-1]
        
    # Check CR/DR/DB suffixes
    if cleaned.upper().endswith("CR") or cleaned.upper().endswith("DB"):
        cleaned = cleaned[:-2].strip()
        
    # Standardize thousands and decimal marks
    cleaned = cleaned.replace(" ", "")
    # Indonesian: dots as thousands, comma as decimal (1.500.000,00)
    if "," in cleaned and "." in cleaned:
        if cleaned.find(",") > cleaned.find("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        # Check if comma is decimal or thousand
        parts = cleaned.split(",")
        if len(parts[-1]) == 2:
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "." in cleaned:
        parts = cleaned.split(".")
        if len(parts[-1]) == 3:
            cleaned = cleaned.replace(".", "")
            
    cleaned = re.sub(r'[^0-9\.]', '', cleaned)
    try:
        val = float(cleaned)
        return -val if is_negative else val
    except ValueError:
        return 0.0

def parse_bca_statement(pages) -> List[Dict[str, Any]]:
    """
    BCA Statement PDF table parser.
    BCA columns usually: Tgl, Keterangan, Mutasi, Saldo (sometimes 5 columns).
    """
    transactions = []
    current_year = datetime.now().year
    
    for page in pages:
        table = page.extract_table()
        if not table:
            # Fallback to line-by-line regex if table extraction fails
            text = page.extract_text()
            if text:
                lines = text.split('\n')
                for line in lines:
                    # Pattern for mutasi line: e.g. 10/07 12345 TRANSFER DR  150.000,00  60.000.000,00
                    # Matches: Date (DD/MM), description, type (DB/CR or amount), mutasi amount, balance
                    match = re.search(r'^(\d{2})/(\d{2})\s+(.*?)\s+([\d\.,]+)\s*([A-Z]{2})?\s+([\d\.,]+)$', line)
                    if match:
                        d, m, desc, amt_str, indicator, bal_str = match.groups()
                        amt = clean_pdf_amount(amt_str)
                        bal = clean_pdf_amount(bal_str)
                        
                        debit, credit = 0.0, 0.0
                        # If indicator is DB/DR or if text says DB, it's a debit
                        if indicator in ["DB", "DR"] or "DB" in desc.upper():
                            debit = amt
                        else:
                            credit = amt
                            
                        transactions.append({
                            "date": f"{current_year}-{m}-{d}",
                            "description": desc.strip(),
                            "debit": debit,
                            "credit": credit,
                            "balance": bal
                        })
            continue

        for row in table:
            # Skip header rows
            if not row or len(row) < 4:
                continue
            
            # BCA row template: [Tgl, Keterangan, Cabang, Mutasi, Saldo] or [Tgl, Keterangan, Mutasi, Saldo]
            tgl_col = row[0]
            # Match date format like "10/07"
            if tgl_col and re.match(r'^\d{2}/\d{2}$', tgl_col.strip()):
                d, m = tgl_col.strip().split('/')
                date_str = f"{current_year}-{m}-{d}"
                
                # Combine description columns
                desc = row[1] or ""
                # cab = row[2] if len(row) > 4 else ""
                mut_str = row[-2] or "0"
                bal_str = row[-1] or "0"
                
                amt = clean_pdf_amount(mut_str)
                bal = clean_pdf_amount(bal_str)
                
                # Determine credit/debit based on indicator or signed value
                debit, credit = 0.0, 0.0
                if "DB" in row[-2] or "DB" in desc or amt < 0:
                    debit = abs(amt)
                else:
                    credit = amt
                    
                transactions.append({
                    "date": date_str,
                    "description": desc.replace('\n', ' ').strip(),
                    "debit": debit,
                    "credit": credit,
                    "balance": bal
                })
                
    return transactions

def parse_mandiri_statement(pages) -> List[Dict[str, Any]]:
    """
    Mandiri Statement PDF table parser.
    Columns: Tanggal, Keterangan, Debet, Kredit, Saldo.
    """
    transactions = []
    
    for page in pages:
        table = page.extract_table()
        if not table:
            continue
            
        for row in table:
            if not row or len(row) < 4:
                continue
            
            tgl_col = row[0]
            # Mandiri date format: "DD/MM/YY" or "DD-MM-YYYY"
            if tgl_col and re.match(r'^\d{2}/\d{2}/\d{2,4}$|^\d{2}-\d{2}-\d{2,4}$', tgl_col.strip()):
                # Parse date
                clean_tgl = tgl_col.strip().replace('-', '/')
                parts = clean_tgl.split('/')
                if len(parts[2]) == 2:
                    parts[2] = "20" + parts[2]
                date_str = f"{parts[2]}-{parts[1]}-{parts[0]}"
                
                desc = row[1] or ""
                # Mandiri has separate debit/credit columns
                deb_str = row[2] or "0"
                crd_str = row[3] or "0"
                bal_str = row[4] or "0" if len(row) > 4 else "0"
                
                debit = clean_pdf_amount(deb_str)
                credit = clean_pdf_amount(crd_str)
                bal = clean_pdf_amount(bal_str)
                
                transactions.append({
                    "date": date_str,
                    "description": desc.replace('\n', ' ').strip(),
                    "debit": debit,
                    "credit": credit,
                    "balance": bal
                })
                
    return transactions

def parse_bni_statement(pages) -> List[Dict[str, Any]]:
    """
    BNI Statement PDF table parser.
    Columns: Tanggal, Uraian, Debit, Kredit, Saldo.
    """
    # BNI matches similar column headers to Mandiri
    return parse_mandiri_statement(pages)

def parse_bri_statement(pages) -> List[Dict[str, Any]]:
    """
    BRI Statement PDF table parser.
    Columns: Tanggal, Transaksi, Debet, Kredit, Saldo.
    """
    return parse_mandiri_statement(pages)

def parse_pdf_mutasi(file_bytes: bytes) -> Dict[str, Any]:
    """
    Main entrypoint to parse statement tables from PDF bytes.
    """
    pdf_file = io.BytesIO(file_bytes)
    
    with pdfplumber.open(pdf_file) as pdf:
        if not pdf.pages:
            return {
                "bank_detected": "Unknown",
                "period": "",
                "transactions": [],
                "confidence": 0.0
            }
            
        # Detect bank format on first page
        first_page_text = pdf.pages[0].extract_text() or ""
        bank = detect_bank_format(first_page_text)
        
        # Extract period text heuristically from first page
        period = ""
        period_match = re.search(r'periode[:\s]*([\d\w\s\-]+)', first_page_text, re.IGNORECASE)
        if period_match:
            period = period_match.group(1).strip()
            
        transactions = []
        if bank == "BCA":
            transactions = parse_bca_statement(pdf.pages)
        elif bank == "Mandiri":
            transactions = parse_mandiri_statement(pdf.pages)
        elif bank == "BNI":
            transactions = parse_bni_statement(pdf.pages)
        elif bank == "BRI":
            transactions = parse_bri_statement(pdf.pages)
        else:
            # Fallback: try BCA format as first guess
            transactions = parse_bca_statement(pdf.pages)
            if not transactions:
                # Try Mandiri format as second guess
                transactions = parse_mandiri_statement(pdf.pages)
                
        confidence = 0.9 if bank != "Unknown" and len(transactions) > 0 else 0.4
        
        return {
            "bank_detected": bank,
            "period": period,
            "transactions": transactions,
            "confidence": confidence
        }
