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


def test_smart_advisor_slang_mixed_polarity_reverse_transfer_and_followup():
    from datetime import datetime, timedelta
    import app.services.ai_service as ai_svc

    accounts = [
        {"id": "acc-bca", "name": "BCA Utama", "bank_provider": "BCA", "type": "bank", "balance": 15_000_000},
        {"id": "acc-gopay", "name": "GoPay Harian", "bank_provider": "GoPay", "type": "e_wallet", "balance": 500_000},
    ]
    categories = [
        {"id": "cat-makan", "name": "Makanan & Minuman", "type": "expense"},
        {"id": "cat-gaji", "name": "Gaji & Bonus", "type": "income"},
    ]

    # Mixed income + multiple expenses in one prompt (must NOT leak income onto expenses)
    mixed = ai_svc.parse_indonesian_action_commands(
        "gaji masuk 10jt ke BCA, bayar kos 1,5jt, listrik 300rb dan beli kopi 15rb pakai GoPay",
        accounts,
        categories,
    )
    assert len(mixed) == 4
    assert [m["payload"]["type"] for m in mixed] == ["income", "expense", "expense", "expense"]
    assert [m["payload"]["amount"] for m in mixed] == [10_000_000, 1_500_000, 300_000, 15_000]

    # Quantity multiplication, Indonesian slang, and "N hari lalu" date
    three_days_ago = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d")
    slang_cmds = ai_svc.parse_indonesian_action_commands(
        "3 hari lalu beli 2x kopi 10rb dan gorengan goceng pakai BCA",
        accounts,
        categories,
    )
    assert len(slang_cmds) == 2
    assert [c["payload"]["amount"] for c in slang_cmds] == [20_000, 5_000]
    assert slang_cmds[0]["payload"]["date"] == three_days_ago

    # Reverse transfer wording ("topup gopay 200rb dr bca")
    rev_trf = ai_svc.parse_indonesian_action_commands("topup gopay 200rb dr bca", accounts, categories)
    assert len(rev_trf) == 1
    assert rev_trf[0]["type"] == "create_transfer"
    assert rev_trf[0]["payload"]["source_account_id"] == "acc-bca"
    assert rev_trf[0]["payload"]["target_account_id"] == "acc-gopay"
    assert rev_trf[0]["payload"]["amount"] == 200_000

    # Targeted follow-up ("yang kopi jadi 12rb") keeps sibling items untouched
    follow_res = asyncio.run(
        ai_svc.chat_advisor(
            message="yang kopi jadi 12rb",
            context_data={"accounts": accounts, "categories": categories},
            provider="local",
            model_name="default",
            api_key=None,
            history=[{"role": "user", "content": "beli kopi 10rb, susu 6rb dan warteg 5rb"}],
        )
    )
    assert len(follow_res["proposed_actions"]) == 3
    assert [a["payload"]["amount"] for a in follow_res["proposed_actions"]] == [12_000, 6_000, 5_000]

    # Daily quota & MoM spending comparison using spending_analytics
    analytics_ctx = {
        "dashboard": {
            "cash_available": {"value": 10_000_000},
            "safe_to_spend": {"value": 3_000_000},
        },
        "emergency_fund": {},
        "budget": {"total_budget": {"value": 5_000_000}, "total_spent": {"value": 2_000_000}},
        "spending_analytics": {
            "current_month_expense": 2_400_000,
            "prev_month_expense": 1_800_000,
            "expense_change_pct": 33.3,
            "daily_burn_rate": 120_000,
            "remaining_days_in_month": 10,
            "top_categories": [{"category": "Makanan & Minuman", "amount": 1_500_000}],
        },
        "accounts": accounts,
        "categories": categories,
    }
    quota_res = asyncio.run(ai_svc.chat_advisor("Cek kuota harian cukup sampai akhir bulan?", analytics_ctx, "local", "default", None))
    assert "300,000" in quota_res["response"]
    assert quota_res.get("suggested_replies")

    mom_res = asyncio.run(ai_svc.chat_advisor("Apakah bulan ini lebih boros dibanding bulan lalu?", analytics_ctx, "local", "default", None))
    assert "naik" in mom_res["response"].lower()
    assert "33.3%" in mom_res["response"]


def test_advisor_v2_spending_analytics_and_suggested_replies():
    import asyncio
    import json
    from app.services.ai_service import chat_advisor, stream_chat_advisor

    rich_ctx = {
        "dashboard": {
            "total_liquid_cash": 6_000_000,
            "monthly_income": 10_000_000,
            "monthly_expense": 3_000_000,
        },
        "emergency_fund": {"ideal_amount": 18_000_000, "current_amount": 6_000_000},
        "budget": {},
        "accounts": [{"id": "acc-bca", "name": "BCA Utama", "type": "bank", "balance": 6_000_000}],
        "categories": [{"id": "cat-makan", "name": "Makanan & Minuman", "type": "expense"}],
        "spending_analytics": {
            "current_month": "2026-11",
            "current_month_expense": 3_000_000,
            "prev_month_expense": 2_500_000,
            "expense_change_pct": 20.0,
            "daily_burn_rate": 120_000,
            "remaining_days_in_month": 5,
            "top_categories": [{"category": "Makanan & Minuman", "amount": 1_800_000}],
        },
    }

    quota_res = asyncio.run(
        chat_advisor(
            "Kuota jajan harian bulan ini?",
            rich_ctx,
            provider="local",
            model_name="default",
            api_key=None,
        )
    )
    assert "response" in quota_res and len(quota_res["response"]) > 20
    assert quota_res.get("suggested_replies"), "Expected suggested_replies for quota question"

    mom_res = asyncio.run(
        chat_advisor(
            "Bandingkan pengeluaran bulan lalu",
            rich_ctx,
            provider="local",
            model_name="default",
            api_key=None,
        )
    )
    assert "2,500,000" in mom_res["response"] or "3,000,000" in mom_res["response"]
    assert mom_res.get("suggested_replies"), "Expected suggested_replies for MoM question"

    async def collect_meta():
        meta_payload = None
        async for chunk in stream_chat_advisor(
            "Kuota jajan harian bulan ini?",
            rich_ctx,
            provider="local",
            model_name="default",
            api_key=None,
        ):
            for line in chunk.splitlines():
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    if "suggested_replies" in data and data.get("type") in ("meta", "done", None):
                        meta_payload = data
        return meta_payload

    meta = asyncio.run(collect_meta())
    assert meta is not None and len(meta.get("suggested_replies", [])) > 0


def test_advisor_v3_tool_engine_actions_and_multimodal():
    import asyncio
    import base64
    from app.services.ai_service import (
        _execute_advisor_tool,
        chat_advisor,
        parse_indonesian_action_commands,
    )

    accounts = [
        {"id": "acc-bca", "name": "BCA Utama", "bank_provider": "BCA", "type": "bank", "balance": 10_000_000},
        {"id": "acc-gopay", "name": "GoPay", "bank_provider": "GoPay", "type": "e_wallet", "balance": 350_000},
    ]
    categories = [
        {"id": "cat-makan", "name": "Makanan & Minuman", "type": "expense"},
        {"id": "cat-tagihan", "name": "Tagihan", "type": "expense"},
    ]
    bills = [
        {"id": "bill-pln", "name": "Tagihan Listrik PLN", "amount": 275_000, "status": "unpaid", "account_id": "acc-bca"},
    ]
    debts = [
        {"id": "debt-spay", "name": "SPayLater", "outstanding_balance": 3_000_000, "interest_rate": 24.0, "minimum_payment": 300_000, "status": "active"},
        {"id": "debt-kta", "name": "KTA Bank", "outstanding_balance": 2_000_000, "interest_rate": 12.0, "minimum_payment": 250_000, "status": "active"},
    ]
    goals = [
        {"id": "goal-libur", "name": "Dana Liburan", "target_amount": 10_000_000, "current_amount": 4_000_000, "progress": 40, "status": "active"},
    ]
    recent_txs = [
        {"id": "tx-kopi-last", "date": "2026-11-26", "type": "expense", "amount": 18_000, "description": "Kopi Kenangan", "category_name": "Makanan & Minuman", "account_name": "GoPay"},
        {"id": "tx-kopi-old", "date": "2026-10-15", "type": "expense", "amount": 22_000, "description": "Kopi Fore", "category_name": "Makanan & Minuman", "account_name": "BCA Utama"},
    ]
    learned_prefs = {
        "debtStrategy": "avalanche",
        "learnedRules": [{"keyword": "kopi", "accountId": "acc-gopay", "categoryId": "cat-makan"}],
    }

    # 1. V3 entity actions + learned merchant rule
    pay_bill_cmds = parse_indonesian_action_commands("bayar tagihan listrik pakai GoPay", accounts, categories, bills=bills)
    assert len(pay_bill_cmds) == 1
    assert pay_bill_cmds[0]["type"] == "pay_bill"
    assert pay_bill_cmds[0]["payload"]["bill_id"] == "bill-pln"
    assert pay_bill_cmds[0]["payload"]["account_id"] == "acc-gopay"
    assert pay_bill_cmds[0]["payload"]["amount"] == 275_000

    pay_debt_cmds = parse_indonesian_action_commands("bayar cicilan spaylater 500rb pakai BCA", accounts, categories, debts=debts)
    assert len(pay_debt_cmds) == 1
    assert pay_debt_cmds[0]["type"] == "pay_debt"
    assert pay_debt_cmds[0]["payload"]["debt_id"] == "debt-spay"
    assert pay_debt_cmds[0]["payload"]["amount"] == 500_000

    contrib_cmds = parse_indonesian_action_commands("nabung 1jt ke target dana liburan pakai BCA", accounts, categories, goals=goals)
    assert len(contrib_cmds) == 1
    assert contrib_cmds[0]["type"] == "contribute_goal"
    assert contrib_cmds[0]["payload"]["goal_id"] == "goal-libur"
    assert contrib_cmds[0]["payload"]["amount"] == 1_000_000

    del_cmds = parse_indonesian_action_commands("hapus transaksi kopi terakhir", accounts, categories, recent_transactions=recent_txs)
    assert len(del_cmds) == 1
    assert del_cmds[0]["type"] == "delete_transaction"
    assert del_cmds[0]["payload"]["transaction_id"] == "tx-kopi-last"

    learned_cmds = parse_indonesian_action_commands("beli kopi 15rb", accounts, categories, preferences=learned_prefs)
    assert len(learned_cmds) == 1
    assert learned_cmds[0]["payload"]["account_id"] == "acc-gopay"

    # 2. Tool execution engine (search_transactions, simulate_debt_payoff, get_wealth_overview)
    full_ctx = {
        "dashboard": {"cash_available": 10_350_000, "safe_to_spend": 6_000_000, "total_debts": 5_000_000, "dti_ratio": 18},
        "emergency_fund": {"total_emergency_fund": 15_000_000, "target_amount": 30_000_000},
        "budget": {},
        "accounts": accounts,
        "categories": categories,
        "debts": debts,
        "goals": goals,
        "upcoming_bills": bills,
        "assets": [{"id": "asset-1", "name": "Reksa Dana Pasar Uang", "type": "investment", "current_value": 25_000_000, "is_liquid": True}],
        "asset_summary": {"total_assets": 25_000_000, "total_liquid": 25_000_000},
        "subscriptions": [{"id": "sub-1", "name": "Netflix", "amount": 186_000, "frequency": "monthly", "unused_warning": True}],
        "monthly_subscription_cost": 186_000,
        "searchable_transactions": recent_txs,
        "recent_transactions": recent_txs,
        "monthly_history": [{"month": "2026-11", "income": 12_000_000, "expense": 4_000_000, "net": 8_000_000}],
    }

    search_out = _execute_advisor_tool("search_transactions", {"keyword": "kopi"}, full_ctx)
    assert search_out["count"] == 2
    assert search_out["total_amount"] == 40_000

    sim_out = _execute_advisor_tool("simulate_debt_payoff", {"strategy": "avalanche", "extra_monthly": 500_000}, full_ctx)
    assert sim_out["months_to_payoff"] < sim_out["months_baseline"]
    assert sim_out["interest_saved"] > 0
    assert sim_out["priority_order"][0] == "SPayLater"

    wealth_out = _execute_advisor_tool("get_wealth_overview", {}, full_ctx)
    assert wealth_out["total_assets"] == 25_000_000
    assert wealth_out["estimated_net_worth"] == 30_350_000
    assert wealth_out["monthly_subscription_cost"] == 186_000

    # 3. Conversational V3 analyzers + attachment notice
    net_res = asyncio.run(chat_advisor("Berapa kekayaan bersih dan aset saya?", full_ctx, "local", "default", None))
    assert "30.350.000" in net_res["response"]

    sub_res = asyncio.run(chat_advisor("Cek langganan aktif saya", full_ctx, "local", "default", None))
    assert "Netflix" in sub_res["response"] and "186.000" in sub_res["response"]

    search_chat = asyncio.run(chat_advisor("Cari transaksi kopi bulan lalu dan sekarang", full_ctx, "local", "default", None))
    assert "40.000" in search_chat["response"]

    # 1x1 valid PNG pixel base64
    tiny_png = base64.b64encode(
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xdc\xccY\xe7\x00\x00\x00\x00IEND\xaeB`\x82"
    ).decode("ascii")
    att_res = asyncio.run(
        chat_advisor(
            "Catat gambar ini",
            full_ctx,
            "local",
            "default",
            None,
            attachments=[{"name": "struk.png", "mime_type": "image/png", "data_base64": tiny_png}],
        )
    )
    assert "response" in att_res


def test_v4_indonesia_wealth_calculators_in_tools_and_chat():
    from app.services.ai_service import _execute_advisor_tool, chat_advisor

    ctx = {
        "dashboard": {"income_this_month": 15_000_000, "expense_this_month": 6_000_000},
        "accounts": [{"id": "acc-1", "name": "BCA", "balance": 120_000_000}],
        "assets": [{"id": "as-1", "name": "SBN Ritel", "current_value": 100_000_000}],
        "debts": [{"id": "d-1", "name": "Cicilan", "outstanding_balance": 10_000_000}],
        "upcoming_bills": [],
        "subscriptions": [],
        "categories": [],
        "recent_transactions": [],
    }

    pph = _execute_advisor_tool("simulate_indonesia_wealth", {"mode": "pph21", "ptkp_status": "K/1", "income_monthly": 15_000_000}, ctx)
    assert pph["ptkp_status"] == "K/1"
    assert pph["ptkp_amount"] == 63_000_000
    assert pph["annual_gross"] == 180_000_000
    assert pph["annual_tax"] > 0

    zakat = _execute_advisor_tool("simulate_indonesia_wealth", {"mode": "zakat", "gold_price_per_gram": 1_500_000}, ctx)
    assert zakat["nishab_maal_annual"] == 127_500_000
    assert zakat["maal_wajib"] is True
    assert zakat["zakat_maal_annual"] == round((120_000_000 + 100_000_000 - 10_000_000) * 0.025)

    edu = _execute_advisor_tool("simulate_indonesia_wealth", {"mode": "education", "years_until_entry": 10, "current_cost": 100_000_000}, ctx)
    assert edu["future_total_cost"] > 250_000_000
    assert edu["required_monthly_saving"] > 1_000_000

    ret = _execute_advisor_tool("simulate_indonesia_wealth", {"mode": "retirement", "current_age": 30, "retirement_age": 55}, ctx)
    assert ret["years_to_retire"] == 25
    assert ret["target_corpus"] > 0

    pph_chat = asyncio.run(chat_advisor("Tolong hitung PPh 21 gaji 15jt K/1", ctx, "local", "default", None))
    assert "PPh 21" in pph_chat["response"] and "15.000.000" in pph_chat["response"] and "63.000.000" in pph_chat["response"]

    zakat_chat = asyncio.run(chat_advisor("Hitung zakat maal dan zakat profesi saya", ctx, "local", "default", None))
    assert "Zakat Maal" in zakat_chat["response"] and "Wajib" in zakat_chat["response"]

    edu_chat = asyncio.run(chat_advisor("Simulasi dana pendidikan kuliah anak 10 tahun biaya 100jt", ctx, "local", "default", None))
    assert "Dana Pendidikan" in edu_chat["response"]

    ret_chat = asyncio.run(chat_advisor("Simulasikan dana pensiun usia 30 pensiun usia 55", ctx, "local", "default", None))
    assert "Dana Pensiun" in ret_chat["response"]


def test_v4_stream_routes_wealth_queries_through_tool_engine(monkeypatch):
    import app.services.ai_service as ai_svc

    called = {"tool_llm": False}

    async def _fake_openai_tools(**kwargs):
        called["tool_llm"] = True
        assert any(t.get("name") == "simulate_indonesia_wealth" for t in ai_svc._ADVISOR_TOOL_DECLARATIONS)
        return (
            "🤖 Saran AI — bukan nasihat keuangan profesional\n"
            "Estimasi PPh 21 Anda dengan PTKP K/1 telah dihitung.\n\n"
            "Alasan: Mengacu tarif progresif UU HPP."
        )

    monkeypatch.setattr(ai_svc, "_call_openai_with_tools", _fake_openai_tools)

    async def _collect():
        frames = []
        async for frame in ai_svc.stream_chat_advisor(
            message="Hitung PPh 21 gaji 15jt K/1",
            context_data={"dashboard": {}, "accounts": [], "categories": []},
            provider="openai",
            model_name="gpt-4o-mini",
            api_key="sk-v4-stream-test",
        ):
            frames.append(json.loads(frame[len("data: ") :].strip()))
        return frames

    frames = asyncio.run(_collect())
    assert called["tool_llm"] is True
    delta_text = "".join(f["content"] for f in frames if f["type"] == "delta")
    assert "PPh 21" in delta_text
    assert frames[-1]["type"] == "done"
