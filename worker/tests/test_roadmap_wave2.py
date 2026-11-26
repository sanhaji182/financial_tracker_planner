import asyncio
import json

from app.services.ai_service import (
    chat_advisor,
    parse_advisor_response,
    parse_indonesian_action_command,
    parse_indonesian_action_commands,
    parse_indonesian_amount,
)
from app.services.pdf_service import (
    annotate_internal_transfers,
    detect_bank_format,
    parse_digital_bank_statement,
)


class _DummyPage:
    def __init__(self, text: str, table=None):
        self._text = text
        self._table = table

    def extract_text(self):
        return self._text

    def extract_table(self):
        return self._table


def test_indonesian_action_command_and_chat_advisor_actions():
    assert parse_indonesian_amount("28rb") == 28_000
    assert parse_indonesian_amount("1,5jt") == 1_500_000
    assert parse_indonesian_amount("setengah juta") == 500_000
    assert parse_indonesian_amount("seratus lima puluh ribu") == 150_000

    accounts = [
        {"id": "acc-bca", "name": "BCA Utama", "bank_provider": "BCA", "type": "bank"},
        {"id": "acc-gopay", "name": "GoPay Harian", "bank_provider": "GoPay", "type": "e_wallet"},
    ]
    categories = [
        {"id": "cat-makan", "name": "Makanan & Minuman", "type": "expense"},
        {"id": "cat-gaji", "name": "Gaji & Bonus", "type": "income"},
    ]

    tx_act = parse_indonesian_action_command("Catat kopi kenangan 28rb pakai GoPay", accounts, categories)
    assert tx_act is not None
    assert tx_act["type"] == "create_transaction"
    assert tx_act["payload"]["amount"] == 28_000
    assert tx_act["payload"]["account_id"] == "acc-gopay"
    assert tx_act["payload"]["category_id"] == "cat-makan"

    trf_act = parse_indonesian_action_command("Transfer 500rb dari BCA ke GoPay", accounts, categories)
    assert trf_act is not None
    assert trf_act["type"] == "create_transfer"
    assert trf_act["payload"]["source_account_id"] == "acc-bca"
    assert trf_act["payload"]["target_account_id"] == "acc-gopay"
    assert trf_act["payload"]["amount"] == 500_000

    budget_act = parse_indonesian_action_command("Atur budget makanan 2jt per bulan", accounts, categories)
    assert budget_act is not None
    assert budget_act["type"] == "set_budget"
    assert budget_act["payload"]["category_id"] == "cat-makan"
    assert budget_act["payload"]["amount"] == 2_000_000

    goal_act = parse_indonesian_action_command("Buat target dana liburan 10jt", accounts, categories)
    assert goal_act is not None
    assert goal_act["type"] == "create_goal"
    assert goal_act["payload"]["target_amount"] == 10_000_000

    # Local worker chat returns structured proposed_actions cleanly
    chat_res = asyncio.run(
        chat_advisor(
            "Catat kopi 32rb pakai BCA",
            {"dashboard": {}, "emergency_fund": {}, "budget": {}, "accounts": accounts, "categories": categories},
            provider="local",
            model_name="default",
            api_key=None,
        )
    )
    assert "proposed_actions" in chat_res
    assert len(chat_res["proposed_actions"]) == 1
    assert chat_res["proposed_actions"][0]["type"] == "create_transaction"
    assert chat_res["proposed_actions"][0]["payload"]["amount"] == 32_000


def test_parse_advisor_response_extracts_actions_block():
    llm_text = (
        "🤖 Saran AI — bukan nasihat keuangan profesional\n"
        "Saya siapkan pencatatan kopi sebesar Rp 28.000.\n"
        "```actions\n"
        + json.dumps(
            [
                {
                    "id": "act-99",
                    "type": "create_transaction",
                    "title": "Catat Kopi",
                    "summary": "Rp 28.000",
                    "payload": {"amount": 28000, "type": "expense", "account_id": "acc-gopay"},
                }
            ]
        )
        + "\n```\nAlasan: Sesuai perintah chat user."
    )
    parsed = parse_advisor_response(llm_text)
    assert "proposed_actions" in parsed
    assert parsed["proposed_actions"][0]["id"] == "act-99"
    assert "actions" not in parsed["response"].lower()
    assert parsed["reason"] == "Sesuai perintah chat user."


def test_digital_bank_e_statements_and_internal_transfer_annotation():
    assert detect_bank_format("PT BANK JAGO TBK - RIWAYAT TRANSAKSI KANTONG") == "Bank Jago"
    assert detect_bank_format("PT BANK SEABANK INDONESIA") == "SeaBank"
    assert detect_bank_format("BLU BY BCA DIGITAL") == "Blu by BCA Digital"
    assert detect_bank_format("GOPAY TABUNGAN BY JAGO") == "Bank Jago"

    page = _DummyPage(
        "\n".join(
            [
                "PT BANK JAGO TBK",
                "21 Nov 2026 09:15 Kopi Kenangan Kemang -Rp 35.000 Rp 2.500.000",
                "21 Nov 2026 10:00 Top Up GoPay Harian -Rp 500.000 Rp 2.000.000",
                "21 Nov 2026 10:01 Terima dari Kantong Utama +Rp 500.000 Rp 1.500.000",
            ]
        )
    )
    txs = parse_digital_bank_statement([page], bank="Bank Jago")
    assert len(txs) == 3
    assert txs[0]["date"] == "2026-11-21"
    assert txs[0]["debit"] == 35_000.0
    assert txs[2]["credit"] == 500_000.0

    annotated, count = annotate_internal_transfers(txs)
    assert count == 2
    assert annotated[0].get("possible_transfer") is not True
    assert annotated[1].get("possible_transfer") is True
    assert annotated[2].get("possible_transfer") is True


def test_multi_item_transaction_splitting_and_llm_guardrail():
    accounts = [
        {"id": "acc-bca", "name": "BCA Utama", "bank_provider": "BCA", "type": "bank"},
        {"id": "acc-gopay", "name": "GoPay Harian", "bank_provider": "GoPay", "type": "e_wallet"},
    ]
    categories = [
        {"id": "cat-makan", "name": "Makanan & Minuman", "type": "expense"},
    ]

    multi = parse_indonesian_action_commands(
        "beli kopi 10rb, susu 6rb dan warteg 5rb", accounts, categories
    )
    assert len(multi) == 3
    assert [m["payload"]["amount"] for m in multi] == [10_000, 6_000, 5_000]
    assert [m["payload"]["description"] for m in multi] == ["Kopi", "Susu", "Warteg"]

    mixed_fmt = parse_indonesian_action_commands(
        "beli kopi 10.000, susu 6.000 dan warteg 5rb pakai GoPay", accounts, categories
    )
    assert len(mixed_fmt) == 3
    assert [m["payload"]["amount"] for m in mixed_fmt] == [10_000, 6_000, 5_000]
    assert all(m["payload"]["account_id"] == "acc-gopay" for m in mixed_fmt)

    # Guardrail recovers when an LLM collapses 3 items into 1 mismatched Rp 5.000 summary action
    buggy_llm = (
        "🤖 Saran AI — bukan nasihat keuangan profesional\n"
        "Saya catatkan keseluruhan Rp 5.000.\n"
        "```actions\n"
        + json.dumps(
            [
                {
                    "id": "act-collapsed",
                    "type": "create_transaction",
                    "title": "Catat Pengeluaran: beli kopi, susu dan warteg",
                    "summary": "Rp 5.000",
                    "payload": {"amount": 5000, "type": "expense", "account_id": "acc-bca"},
                }
            ]
        )
        + "\n```\nAlasan: Ringkasan chat."
    )
    guarded = parse_advisor_response(buggy_llm, fallback_actions=multi)
    assert len(guarded["proposed_actions"]) == 3
    assert [a["payload"]["amount"] for a in guarded["proposed_actions"]] == [10_000, 6_000, 5_000]

    res_local = asyncio.run(
        chat_advisor(
            "beli kopi 10rb, susu 6rb dan warteg 5rb",
            {"dashboard": {}, "emergency_fund": {}, "budget": {}, "accounts": accounts, "categories": categories},
            provider="local",
            model_name="default",
            api_key=None,
        )
    )
    assert len(res_local["proposed_actions"]) == 3
    assert "21.000" in res_local["response"]

    # V2: qty multiplication, slang, reverse transfer, mixed polarity & multi-turn follow-up
    assert parse_indonesian_amount("2x 10rb") == 20_000
    assert parse_indonesian_amount("goceng") == 5_000
    assert parse_indonesian_amount("ceban") == 10_000

    accounts_v2 = accounts + [{"id": "acc-gopay-v2", "name": "GoPay", "type": "e_wallet", "balance": 200_000}]
    rev_transfer = parse_indonesian_action_commands(
        "3 hari lalu topup GoPay 200rb dr BCA",
        accounts_v2,
        categories,
    )
    assert len(rev_transfer) == 1
    assert rev_transfer[0]["type"] == "create_transfer"
    assert rev_transfer[0]["payload"]["amount"] == 200_000
    assert rev_transfer[0]["payload"]["source_account_id"] == "acc-bca"
    assert rev_transfer[0]["payload"]["target_account_id"] == "acc-gopay"

    mixed_actions = parse_indonesian_action_commands(
        "gaji masuk 10jt ke BCA, bayar listrik 300rb, beli kopi 15rb",
        accounts_v2,
        categories,
    )
    assert len(mixed_actions) == 3
    assert [item["payload"]["type"] for item in mixed_actions] == ["income", "expense", "expense"]
    assert [item["payload"]["amount"] for item in mixed_actions] == [10_000_000, 300_000, 15_000]

    followup_res = asyncio.run(
        chat_advisor(
            "yang kopi jadi 12rb",
            {"dashboard": {}, "emergency_fund": {}, "budget": {}, "accounts": accounts, "categories": categories},
            provider="local",
            model_name="default",
            api_key=None,
            history=[{"role": "user", "content": "beli kopi 10rb, susu 6rb dan warteg 5rb"}],
        )
    )
    assert len(followup_res["proposed_actions"]) == 3
    assert [item["payload"]["amount"] for item in followup_res["proposed_actions"]] == [12_000, 6_000, 5_000]
