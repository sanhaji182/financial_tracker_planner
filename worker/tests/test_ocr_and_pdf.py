import base64
import io
from PIL import Image, ImageDraw, ImageFont

from app.services.ai_service import detect_image_mime, mock_enhance_ocr
from app.services.ocr_service import extract_document_text, process_ocr_receipt
from app.services.pdf_service import parse_pdf_mutasi


def _render_receipt_image(lines: list[str]) -> Image.Image:
    width = 900
    line_height = 46
    height = 120 + len(lines) * line_height
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=28)

    y = 40
    for line in lines:
        draw.text((40, y), line, fill=(0, 0, 0), font=font)
        y += line_height
    return img


def test_process_ocr_receipt_extracts_fields_and_raw_text():
    img = _render_receipt_image(
        [
            "INDOMARET KEMANG",
            "21/11/2026 14:30",
            "KOPI KENANGAN 2x 15.000",
            "ROTI TAWAR 1x 15.000",
            "SUBTOTAL Rp 45.000",
            "GRAND TOTAL Rp 45.000",
            "PEMBAYARAN QRIS",
        ]
    )
    buf = io.BytesIO()
    img.save(buf, format="PNG")

    result = process_ocr_receipt(buf.getvalue())
    parsed = result["parsed_data"]

    assert "INDOMARET" in parsed["merchant_name"].upper()
    assert parsed["date"] == "2026-11-21"
    assert parsed["total"] == 45000.0
    assert parsed["payment_method"] == "qris"
    assert "raw_text" in result and "GRAND TOTAL" in result["raw_text"].upper()
    assert "engine" in result and "tesseract" in result["engine"]


def test_parse_pdf_mutasi_scanned_pdf_fallback():
    # Create an image-only scanned PDF with no digital text layer
    img = _render_receipt_image(
        [
            "BANK CENTRAL ASIA",
            "PERIODE NOV 2026",
            "21/11 BELANJA QRIS GRAND MART 125.000,00 DB 5.000.000,00",
            "22/11 GAJI BULANAN 8.000.000,00 CR 13.000.000,00",
        ]
    )
    pdf_buf = io.BytesIO()
    img.save(pdf_buf, format="PDF")
    pdf_bytes = pdf_buf.getvalue()

    result = parse_pdf_mutasi(pdf_bytes)
    assert result["extraction_method"] == "scanned_pdf_ocr"
    assert len(result["transactions"]) >= 1

    doc_text = extract_document_text(pdf_bytes, "scanned_statement.pdf")
    assert doc_text["method"] == "scanned_pdf_ocr"
    assert len(doc_text["text"]) > 20


def test_ai_mime_detection_and_item_normalization():
    png_b64 = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()
    webp_b64 = base64.b64encode(b"RIFF1234WEBP").decode()
    jpg_b64 = base64.b64encode(b"\xff\xd8\xff\xe0fake").decode()

    assert detect_image_mime(png_b64, "receipt.png") == "image/png"
    assert detect_image_mime(webp_b64, "receipt.webp") == "image/webp"
    assert detect_image_mime(jpg_b64, "receipt.jpg") == "image/jpeg"

    enhanced = mock_enhance_ocr(
        {
            "raw_text": "INDOMARET",
            "parsed_data": {
                "merchant_name": "ind0maret",
                "date": "21/11/2026",
                "items": [{"name": "Susu UHT", "qty": 2, "price": 12000, "total": 24000}],
                "total": 0,
                "payment_method": "qris",
            },
        }
    )
    assert enhanced["parsed_data"]["merchant_name"] == "Indomaret"
    assert enhanced["parsed_data"]["date"] == "2026-11-21"
    assert enhanced["parsed_data"]["total"] == 24000
    assert enhanced["parsed_data"]["items"][0]["quantity"] == 2
