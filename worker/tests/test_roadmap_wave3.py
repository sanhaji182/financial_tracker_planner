import asyncio
import json

import pytest
from fastapi import HTTPException

from app.services.ai_service import chat_advisor, stream_chat_advisor
from app.services.email_statement_service import parse_inbound_email_statement
from app.services.voice_service import transcribe_voice_note
from main import verify_service_auth


def test_transcribe_voice_note_text_fallback_and_offline_audio():
    ctx = {
        "accounts": [
            {"id": "acc-bca", "name": "BCA Utama", "bank_provider": "BCA", "type": "bank"},
            {"id": "acc-gopay", "name": "GoPay Harian", "bank_provider": "GoPay", "type": "e_wallet"},
        ],
        "categories": [
            {"id": "cat-makan", "name": "Makanan & Minuman", "type": "expense"},
        ],
    }

    res_text = asyncio.run(
        transcribe_voice_note(
            audio_bytes="Kopi Kenangan 32rb pakai GoPay".encode("utf-8"),
            filename="note.txt",
            mime_type="text/plain",
            provider="local",
            context=ctx,
        )
    )
    assert res_text["needs_manual_transcript"] is False
    assert res_text["parsed_amount"] == 32_000
    assert len(res_text["proposed_actions"]) == 1
    assert res_text["proposed_actions"][0]["payload"]["account_id"] == "acc-gopay"

    res_audio = asyncio.run(
        transcribe_voice_note(
            audio_bytes=b"\x1a\x45\xdf\xa3mock-webm-bytes",
            filename="voice.webm",
            mime_type="audio/webm",
            provider="local",
            context=ctx,
        )
    )
    assert res_audio["needs_manual_transcript"] is True
    assert res_audio["proposed_actions"] == []


def test_chat_advisor_multiturn_followup_and_sse_streaming():
    ctx = {
        "dashboard": {},
        "emergency_fund": {},
        "budget": {},
        "accounts": [
            {"id": "acc-bca", "name": "BCA Utama", "bank_provider": "BCA", "type": "bank"},
        ],
        "categories": [
            {"id": "cat-makan", "name": "Makanan & Minuman", "type": "expense"},
        ],
    }

    history = [
        {"role": "user", "content": "catat kopi 28rb BCA"},
        {"role": "assistant", "content": "Draf Rp 28.000 sudah disiapkan."},
    ]

    followup = asyncio.run(
        chat_advisor(
            message="ubah jadi 45rb",
            context_data=ctx,
            provider="local",
            model_name="default",
            api_key=None,
            history=history,
        )
    )
    assert "proposed_actions" in followup
    assert followup["proposed_actions"][0]["payload"]["amount"] == 45_000
    assert followup["proposed_actions"][0]["payload"]["account_id"] == "acc-bca"

    async def _collect():
        frames = []
        async for frame in stream_chat_advisor(
            message="ubah jadi 45rb",
            context_data=ctx,
            provider="local",
            model_name="default",
            api_key=None,
            history=history,
        ):
            assert frame.startswith("data: ")
            frames.append(json.loads(frame[len("data: ") :].strip()))
        return frames

    frames = asyncio.run(_collect())
    assert frames[0]["type"] == "meta"
    assert frames[0]["proposed_actions"][0]["payload"]["amount"] == 45_000
    assert any(f["type"] == "delta" for f in frames)
    assert frames[-1]["type"] == "done"

    reconstructed = "".join(f["content"] for f in frames if f["type"] == "delta")
    assert "45.000" in reconstructed


def test_parse_inbound_email_statement_html_and_text():
    bca_email = parse_inbound_email_statement(
        subject="Notifikasi Transaksi QRIS BCA",
        sender="alerts@bca.co.id",
        body_html=(
            "<div>Halo Nasabah BCA,<br/>Pembayaran <b>QRIS</b> berhasil.<br/>"
            "Merchant: Kopi Kenangan Senopati<br/>"
            "Tanggal: 23 Nov 2026<br/>"
            "Nominal: Rp 42.500</div>"
        ),
    )
    assert bca_email["bank"] == "BCA"
    assert bca_email["parsed_count"] == 1
    assert bca_email["transactions"][0]["debit"] == 42_500.0
    assert bca_email["transactions"][0]["channel"] == "QRIS"
    assert bca_email["transactions"][0]["date"] == "2026-11-23"

    mandiri_credit = parse_inbound_email_statement(
        subject="Livin' by Mandiri - Dana Masuk",
        sender="no-reply@bankmandiri.co.id",
        body_text=(
            "Transfer Masuk BI-FAST sebesar IDR 2.500.000 pada 2026-11-23 "
            "dari PT Nusantara Jaya"
        ),
    )
    assert mandiri_credit["bank"] == "Mandiri"
    assert mandiri_credit["parsed_count"] == 1
    assert mandiri_credit["transactions"][0]["credit"] == 2_500_000.0
    assert mandiri_credit["transactions"][0]["channel"] == "BI-FAST"


def test_verify_service_auth_fail_closed_and_constant_time(monkeypatch):
    import main as worker_main

    monkeypatch.setattr(worker_main, "WORKER_SECRET", "")
    monkeypatch.setenv("WORKER_SECRET", "")
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(HTTPException) as exc_prod:
        verify_service_auth(None)
    assert exc_prod.value.status_code == 503

    monkeypatch.setenv("APP_ENV", "development")
    verify_service_auth(None)

    monkeypatch.setenv("WORKER_SECRET", "super-secret-worker-key")
    with pytest.raises(HTTPException) as exc_missing:
        verify_service_auth(None)
    assert exc_missing.value.status_code == 401

    with pytest.raises(HTTPException) as exc_wrong:
        verify_service_auth("wrong-key")
    assert exc_wrong.value.status_code == 401

    verify_service_auth("super-secret-worker-key")


def test_advisor_rich_go_context_relative_dates_and_live_llm_streaming(monkeypatch):
    from datetime import datetime, timedelta
    import app.services.ai_service as ai_svc

    accounts = [
        {"id": "acc-bca", "name": "BCA Utama", "bank_provider": "BCA", "type": "bank", "balance": 15_000_000},
    ]
    categories = [
        {"id": "cat-makan", "name": "Makanan & Minuman", "type": "expense"},
    ]

    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    cmds = ai_svc.parse_indonesian_action_commands("kemarin beli kopi 12rb pakai BCA", accounts, categories)
    assert len(cmds) == 1
    assert cmds[0]["payload"]["date"] == yesterday
    assert cmds[0]["payload"]["amount"] == 12_000

    rich_ctx = {
        "dashboard": {
            "net_worth": {"value": 50_000_000},
            "cash_available": {"value": 15_000_000},
            "safe_to_spend": {"value": 4_200_000},
            "total_debts": {"total_outstanding": 12_000_000, "active_count": 2},
            "dti_ratio": 18.5,
            "health_score": {"score": 84, "rating": "Good"},
            "upcoming_bills": [{"name": "Internet Biznet", "amount": 350_000, "days_remaining": 3}],
        },
        "emergency_fund": {"total_emergency_fund": {"value": 15_000_000}, "target_amount": {"value": 30_000_000}, "coverage_months": 3},
        "budget": {"total_budget": {"value": 5_000_000}, "total_spent": {"value": 2_100_000}},
        "accounts": accounts,
        "categories": categories,
        "debts": [
            {"name": "Kartu Kredit", "outstanding_balance": 4_000_000, "interest_rate": 21.0},
            {"name": "KTA", "outstanding_balance": 8_000_000, "interest_rate": 11.0},
        ],
    }

    bills_ans = asyncio.run(ai_svc.chat_advisor("Tagihan bulan ini apa saja?", rich_ctx, "local", "default", None))
    assert "Internet Biznet" in bills_ans["response"]

    debt_ans = asyncio.run(ai_svc.chat_advisor("Bagaimana strategi utang?", rich_ctx, "local", "default", None))
    assert "12,000,000" in debt_ans["response"]
    assert "Kartu Kredit" in debt_ans["response"]

    async def _fake_tokens(**_kwargs):
        chunks = [
            "🤖 Saran AI — bukan nasihat keuangan profesional\n",
            "Dana darurat Anda saat ini Rp 15.000.000 ",
            "dengan Safe-to-Spend Rp 4.200.000.\n",
            "Alasan: Mengacu pada saldo kas likuid dan DTI 18.5%.",
        ]
        for ch in chunks:
            yield ch

    monkeypatch.setattr(ai_svc, "_stream_raw_llm_tokens", _fake_tokens)

    async def _collect_live():
        frames = []
        async for frame in ai_svc.stream_chat_advisor(
            message="Bagaimana dana darurat saya?",
            context_data=rich_ctx,
            provider="openai",
            model_name="gpt-4o-mini",
            api_key="sk-live-mock",
        ):
            frames.append(json.loads(frame[len("data: ") :].strip()))
        return frames

    live_frames = asyncio.run(_collect_live())
    assert live_frames[0]["type"] == "meta"
    delta_text = "".join(f["content"] for f in live_frames if f["type"] == "delta")
    assert "Safe-to-Spend Rp 4.200.000" in delta_text
    assert "Alasan:" not in delta_text
    assert any(f["type"] == "meta" and "DTI 18.5%" in f.get("reason", "") for f in live_frames)
    assert live_frames[-1]["type"] == "done"
