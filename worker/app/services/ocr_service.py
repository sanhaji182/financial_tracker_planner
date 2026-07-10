import re
import io
import math
from PIL import Image, ImageEnhance, ImageOps
import pytesseract
from typing import Dict, Any, List

def preprocess_image(image_bytes: bytes) -> Image.Image:
    """
    Applies image preprocessing to improve OCR accuracy:
    - Convert to grayscale
    - Enhance contrast
    - Binarization (thresholding)
    """
    image = Image.open(io.BytesIO(image_bytes))
    
    # 1. Grayscale
    image = ImageOps.grayscale(image)
    
    # 2. Enhance contrast
    enhancer = ImageEnhance.Contrast(image)
    image = enhancer.enhance(2.0)
    
    # 3. Deskew placeholder (Pillow doesn't have native auto-deskew, 
    # but we can try to auto-rotate if Tesseract provides orientation info)
    try:
        osd = pytesseract.image_to_osd(image)
        angle = re.search(r'Rotate: (\d+)', osd)
        if angle:
            rot_angle = int(angle.group(1))
            if rot_angle != 0:
                image = image.rotate(-rot_angle, expand=True)
    except Exception:
        # Ignore OSD errors (e.g., if there's not enough text)
        pass

    return image

def extract_confidence_metrics(data_df: Dict[str, List[Any]], target_words: List[str]) -> float:
    """
    Retrieves the average Tesseract confidence level (0.0 - 1.0) for the matched words.
    """
    if not target_words or 'text' not in data_df:
        return 0.8  # default fallback if no word matched
    
    confidences = []
    texts = data_df['text']
    confs = data_df['conf']
    
    for word in target_words:
        cleaned_word = re.sub(r'[^a-zA-Z0-9]', '', word.lower())
        if not cleaned_word:
            continue
        # Find matching word in tesseract word data
        matched_conf = []
        for t, c in zip(texts, confs):
            if not isinstance(t, str):
                continue
            cleaned_t = re.sub(r'[^a-zA-Z0-9]', '', t.lower())
            if cleaned_word in cleaned_t or cleaned_t in cleaned_word:
                # Tesseract conf ranges from 0 to 100 (-1 means no conf)
                if c != -1:
                    matched_conf.append(float(c) / 100.0)
        if matched_conf:
            confidences.append(sum(matched_conf) / len(matched_conf))
            
    if confidences:
        return sum(confidences) / len(confidences)
    return 0.7  # default fallback

def clean_amount(amt_str: str) -> float:
    """
    Cleans amount string by removing currency symbols, dots, commas, 
    and converting to float. Handles Indonesian format (Rp 150.000,00 or similar).
    """
    if not amt_str:
        return 0.0
    
    # Remove currency indicator 'Rp', 'rp', '$', 'EUR', etc.
    cleaned = re.sub(r'[Rr]p|[\$\€]', '', amt_str).strip()
    
    # Check if there is a decimal comma (Indonesian format: 150.000,00)
    # or decimal dot (US format: 150,000.00)
    if ',' in cleaned and '.' in cleaned:
        # Both exist. Determine order
        if cleaned.find(',') > cleaned.find('.'):
            # dot is thousands, comma is decimal: e.g. 1.250.000,50
            cleaned = cleaned.replace('.', '').replace(',', '.')
        else:
            # comma is thousands, dot is decimal: e.g. 1,250,000.50
            cleaned = cleaned.replace(',', '')
    elif ',' in cleaned:
        # Only comma exists. If followed by 2 digits, it's likely decimal: e.g. 150000,00
        # If followed by 3 digits, it's likely thousands: e.g. 150,000
        parts = cleaned.split(',')
        if len(parts[-1]) == 2:
            cleaned = cleaned.replace('.', '').replace(',', '.')
        else:
            cleaned = cleaned.replace(',', '')
    elif '.' in cleaned:
        # Only dot exists. If followed by 3 digits, it's likely thousands: e.g. 150.000
        # Else, likely decimal: e.g. 150.50
        parts = cleaned.split('.')
        if len(parts[-1]) == 3:
            cleaned = cleaned.replace('.', '')
            
    # Remove all remaining non-numeric chars except digits and dot
    cleaned = re.sub(r'[^0-9\.]', '', cleaned)
    try:
        return float(cleaned)
    except ValueError:
        return 0.0

def parse_receipt_text(text: str, data_df: Dict[str, List[Any]]) -> Dict[str, Any]:
    """
    Heuristically parses merchant name, date, total, items, and payment method from receipt OCR text.
    """
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    
    # 1. Extract Merchant Name
    # Usually the first 1-3 lines of the receipt
    merchant_name = "Merchant Unknown"
    merchant_conf = 0.5
    for line in lines[:3]:
        # Filter out lines that look like dates, times, or phone numbers
        if not re.search(r'\d{4}|\d{2}[-/.]\d{2}|telp|phone|jalan|jl\.', line, re.IGNORECASE) and len(line) > 3:
            merchant_name = line
            # Clean up merchant name (e.g. remove trailing symbols)
            merchant_name = re.sub(r'^[\*\-\#\s]+|[\*\-\#\s]+$', '', merchant_name)
            merchant_conf = extract_confidence_metrics(data_df, merchant_name.split())
            break

    # 2. Extract Date
    # Match dates like DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, or DD Mon YYYY
    date_str = ""
    date_conf = 0.0
    date_pattern = r'\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b'
    date_match = re.search(date_pattern, text)
    if date_match:
        d, m, y = date_match.groups()
        # Standardize to YYYY-MM-DD
        if len(y) == 2:
            y = "20" + y
        if len(d) == 1:
            d = "0" + d
        if len(m) == 1:
            m = "0" + m
        date_str = f"{y}-{m}-{d}"
        date_conf = extract_confidence_metrics(data_df, [date_match.group(0)])
    else:
        # Try words format e.g. 10 Juli 2026
        months_regex = r'(jan|feb|mar|apr|mei|jun|jul|agu|sep|okt|nov|des)[a-z]*'
        date_word_pattern = rf'\b(\d{{1,2}})\s+({months_regex})\s+(\d{{4}})\b'
        date_word_match = re.search(date_word_pattern, text, re.IGNORECASE)
        if date_word_match:
            d_w, m_w, y_w = date_word_match.groups()[:3]
            # Convert Indonesian month to numeric
            months_map = {
                'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'mei': '05', 'jun': '06',
                'jul': '07', 'agu': '08', 'sep': '09', 'okt': '10', 'nov': '11', 'des': '12'
            }
            m_num = months_map.get(m_w.lower()[:3], '01')
            if len(d_w) == 1:
                d_w = "0" + d_w
            date_str = f"{y_w}-{m_num}-{d_w}"
            date_conf = extract_confidence_metrics(data_df, [date_word_match.group(0)])
        else:
            # Fallback to empty date (which triggers review)
            date_str = ""
            date_conf = 0.0

    # 3. Extract Total Amount
    # Match lines like "TOTAL", "JUMLAH", "GRAND TOTAL", "BAYAR"
    total_val = 0.0
    total_conf = 0.0
    total_match_word = ""
    
    # We look for lines containing key words and numbers
    total_keywords = r'total|jumlah|grand\s*total|netto|bayar|net\s*amount|cash|tunai'
    total_pattern = rf'(?:{total_keywords})[:\s]*([Rr]p\.?\s*)?([\d\.,\s]+)'
    
    # Search from bottom upwards as total is usually at the bottom
    for line in reversed(lines):
        m = re.search(total_pattern, line, re.IGNORECASE)
        if m:
            amt_str = m.group(2).strip()
            # Must contain at least one digit
            if re.search(r'\d', amt_str):
                cleaned = clean_amount(amt_str)
                if cleaned > total_val:
                    total_val = cleaned
                    total_match_word = line
                    total_conf = extract_confidence_metrics(data_df, line.split())
                    
    if total_val == 0.0:
        # Fallback to any large currency-like numbers in text
        nums = re.findall(r'(?:[Rr]p\.?\s*)?([\d\.,]{4,})\b', text)
        for num in nums:
            cleaned = clean_amount(num)
            if cleaned > total_val:
                total_val = cleaned
                total_conf = 0.4  # low confidence fallback

    # 4. Extract Payment Method
    payment_method = "cash"  # default
    pay_conf = 0.5
    pay_patterns = [
        ("gopay", r'gopay|go-pay'),
        ("ovo", r'ovo'),
        ("debit_card", r'debit|card|kartu|visa|mastercard|bca|mandiri|bri'),
        ("cash", r'cash|tunai|kembalian|kembali'),
    ]
    for method, pattern in pay_patterns:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            payment_method = method
            pay_conf = extract_confidence_metrics(data_df, [m.group(0)])
            break

    # 5. Extract Items List (Basic heuristics)
    items = []
    # Lines that look like: Item Name  1x 15.000 or similar
    item_pattern = r'^(.*?)\s+(\d+)\s*[xX\*]\s*([\d\.,\s]+)'
    for line in lines:
        match = re.search(item_pattern, line)
        if match:
            item_name = match.group(1).strip()
            qty = int(match.group(2))
            price = clean_amount(match.group(3))
            
            # Clean item name
            item_name = re.sub(r'^[\*\-\#\s\.]+|[\*\-\#\s\.]+$', '', item_name)
            if len(item_name) > 2 and price > 0:
                items.append({
                    "name": item_name,
                    "quantity": qty,
                    "price": price,
                    "total": qty * price
                })

    # If no structured items found, try lines with a name and single price
    if not items:
        for line in lines:
            # Avoid total line
            if re.search(total_keywords, line, re.IGNORECASE):
                continue
            # Look for: Name  15.000 or Name Rp 15.000
            single_item_match = re.search(r'^([a-zA-Z\s\d\-]+)\s+([Rr]p\.?\s*)?([\d\.,]{4,})$', line)
            if single_item_match:
                item_name = single_item_match.group(1).strip()
                price = clean_amount(single_item_match.group(3))
                if len(item_name) > 2 and price > 0:
                    items.append({
                        "name": item_name,
                        "quantity": 1,
                        "price": price,
                        "total": price
                    })

    # Overall Confidence Calculation
    valid_scores = [s for s in [merchant_conf, date_conf, total_conf, pay_conf] if s > 0]
    overall_confidence = sum(valid_scores) / len(valid_scores) if valid_scores else 0.5
    
    # Cap between 0.0 and 1.0
    overall_confidence = max(0.0, min(1.0, overall_confidence))
    
    needs_review = overall_confidence < 0.7 or not date_str or total_val == 0.0
    
    # Compile confidence mapping per field
    confidence_map = {
        "merchant_name": merchant_conf,
        "date": date_conf,
        "total": total_conf,
        "payment_method": pay_conf,
    }

    return {
        "parsed_data": {
            "merchant_name": merchant_name,
            "date": date_str,
            "items": items,
            "total": total_val,
            "payment_method": payment_method
        },
        "confidence_scores": confidence_map,
        "overall_confidence": round(overall_confidence, 2),
        "needs_review": needs_review
    }

def process_ocr_receipt(image_bytes: bytes) -> Dict[str, Any]:
    """
    Main entrypoint to preprocess and run OCR text parsing.
    """
    preprocessed_img = preprocess_image(image_bytes)
    
    # Run OCR text string
    raw_text = pytesseract.image_to_string(preprocessed_img)
    
    # Run OCR structured data to capture confidence mappings
    try:
        data_df = pytesseract.image_to_data(preprocessed_img, output_type=pytesseract.Output.DICT)
    except Exception:
        data_df = {}
        
    return parse_receipt_text(raw_text, data_df)
