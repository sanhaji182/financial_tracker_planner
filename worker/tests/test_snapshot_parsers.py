import io
import os
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from app.services.ocr_service import PDFPasswordError
from app.services.snapshot_service import (
    parse_account_snapshot_heuristic,
    parse_debt_payment_heuristic,
    parse_debt_snapshot_heuristic,
)
from main import app


def _auth_headers() -> dict[str, str]:
    secret = os.getenv("WORKER_SECRET", "")
    return {"X-Worker-Secret": secret} if secret else {}


def _render_lines_image(lines: list[str]) -> bytes:
    width = 1000
    line_height = 48
    height = 120 + len(lines) * line_height
    img = Image.new("RGB", (width, height), color=(255, 255, 255))
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default(size=28)

    y = 40
    for line in lines:
        draw.text((40, y), line, fill=(0, 0, 0), font=font)
        y += line_height

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def test_parse_debt_snapshot_spaylater_excludes_limit():
    client = TestClient(app)
    img_bytes = _render_lines_image(
        [
            "SPayLater",
            "Limit Tersedia Rp 12.000.000",
            "Total Tagihan Rp 2.450.000",
            "Tagihan Bulan Ini Rp 650.000",
            "Jatuh Tempo 5 Des 2026",
            "Cicilan 2/4",
        ]
    )

    resp = client.post(
        "/parse/debt-snapshot",
        headers=_auth_headers(),
        files={"file": ("spaylater.png", img_bytes, "image/png")},
    )
    assert resp.status_code == 200
    data = resp.json()
    debt = data["parsed_debt"]

    assert "SPAYLATER" in debt["name"].upper()
    assert "SHOPEE" in debt["creditor"].upper()
    assert debt["type"] == "installment"
    assert debt["outstanding_balance"] == 2450000.0
    assert debt["minimum_payment"] == 650000.0
    assert debt["due_day"] == 5
    assert debt["tenor_months"] == 4
    assert debt["original_amount"] == 2450000.0
    assert any("pinjaman awal" in w.lower() for w in data["warnings"])


def test_parse_debt_payment_receipt():
    client = TestClient(app)
    img_bytes = _render_lines_image(
        [
            "Pembayaran SPayLater Berhasil",
            "Sumber Dana: BCA",
            "Total Bayar Rp 650.000",
            "21 Nov 2026",
            "No. Referensi REF998877",
        ]
    )

    resp = client.post(
        "/parse/debt-payment",
        headers=_auth_headers(),
        files={"file": ("bayar.png", img_bytes, "image/png")},
    )
    assert resp.status_code == 200
    pay = resp.json()["parsed_payment"]

    assert pay["amount"] == 650000.0
    assert pay["payment_date"] == "2026-11-21"
    assert pay["source_account_hint"] == "BCA"
    assert pay["reference_number"] == "REF998877"


def test_parse_account_snapshot_bank_and_ewallet():
    client = TestClient(app)
    bca_img = _render_lines_image(
        [
            "Bank Central Asia",
            "No. Rekening 8012345678",
            "Saldo Efektif Rp 15.750.000",
            "21/11/2026",
        ]
    )
    resp_bca = client.post(
        "/parse/account-snapshot",
        headers=_auth_headers(),
        files={"file": ("bca.png", bca_img, "image/png")},
    )
    assert resp_bca.status_code == 200
    acc_bca = resp_bca.json()["parsed_account"]
    assert acc_bca["type"] == "bank"
    assert acc_bca["bank_provider"] == "BCA"
    assert acc_bca["balance"] == 15750000.0
    assert acc_bca["account_number"].endswith("5678")
    assert acc_bca["balance_date"] == "2026-11-21"

    gopay_img = _render_lines_image(
        [
            "GoPay",
            "Saldo Rp 425.000",
        ]
    )
    resp_gp = client.post(
        "/parse/account-snapshot",
        headers=_auth_headers(),
        files={"file": ("gopay.png", gopay_img, "image/png")},
    )
    assert resp_gp.status_code == 200
    acc_gp = resp_gp.json()["parsed_account"]
    assert acc_gp["type"] == "e_wallet"
    assert acc_gp["bank_provider"] == "GoPay"
    assert acc_gp["balance"] == 425000.0


def test_password_protected_pdf_returns_422_and_invalid_type_400():
    client = TestClient(app)

    bad_resp = client.post(
        "/parse/debt-snapshot",
        headers=_auth_headers(),
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert bad_resp.status_code == 400

    class FakePasswordExc(Exception):
        pass

    with patch("app.services.snapshot_service.pdfplumber.open", side_effect=FakePasswordExc("PDF password required")):
        resp_missing = client.post(
            "/parse/debt-snapshot",
            headers=_auth_headers(),
            files={"file": ("cc.pdf", b"%PDF-1.4 encrypted", "application/pdf")},
        )
        assert resp_missing.status_code == 422
        assert resp_missing.json()["detail"]["code"] == "PDF_PASSWORD_REQUIRED"

        resp_wrong = client.post(
            "/parse/account-snapshot",
            headers=_auth_headers(),
            files={"file": ("stmt.pdf", b"%PDF-1.4 encrypted", "application/pdf")},
            data={"pdf_password": "wrong"},
        )
        assert resp_wrong.status_code == 422
        assert resp_wrong.json()["detail"]["code"] == "PDF_INVALID_PASSWORD"


def test_heuristic_monthly_interest_conversion():
    parsed = parse_debt_snapshot_heuristic(
        "Kredivo\nTotal Tagihan Rp 3.000.000\nBunga 2.5% per bulan\nTenor 6 bulan"
    )
    assert parsed["parsed_debt"]["interest_rate"] == 30.0
    assert parsed["parsed_debt"]["tenor_months"] == 6
    assert any("dikonversi" in w.lower() for w in parsed["warnings"])
    assert parse_debt_payment_heuristic("Total Bayar Rp 500.000\n2026-11-20")["parsed_payment"]["amount"] == 500000.0
    assert parse_account_snapshot_heuristic("SeaBank\nSaldo Rp 1.000.000")["parsed_account"]["balance"] == 1000000.0
    assert PDFPasswordError("PDF_PASSWORD_REQUIRED", "err").code == "PDF_PASSWORD_REQUIRED"
