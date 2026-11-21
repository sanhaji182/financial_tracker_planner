# P3: AI Advisor Guardrails

## Konteks

Saat ini AI advisor (`worker/app/services/ai_service.py`) mengirim prompt ke LLM tanpa guardrail yang memadai. Risiko:
- AI bisa memberikan nasihat investasi spesifik tanpa disclaimer
- Data finansial sensitif dikirim ke provider LLM
- Tidak ada filtering untuk dangerous advice
- Tidak ada audit trail

## File Terkait

- `worker/app/services/ai_service.py` — fungsi `chat_advisor()`
- `worker/main.py` — endpoint `/ai/chat`
- `backend/internal/service/ai_settings_service.go` — `CallWorkerAI()`

## Yang Perlu Diubah

### 1. worker/app/services/ai_service.py — Tambah System Prompt Guardrail

```python
ADVISOR_SYSTEM_PROMPT = """You are a personal finance education assistant, NOT a licensed financial advisor.

IMPORTANT RULES:
1. NEVER recommend specific stocks, funds, or investment products
2. NEVER predict specific returns or guarantee outcomes
3. ALWAYS include this disclaimer when giving financial guidance:
   "Ini adalah informasi edukasi, bukan nasihat finansial. Konsultasikan dengan penasihat keuangan berlisensi."
4. NEVER help with tax evasion, fraud, or illegal financial activities
5. NEVER suggest specific insurance products by name/brand
6. DO NOT make assumptions about user's risk tolerance - ask
7. ALWAYS suggest consulting a professional for decisions above Rp 50,000,000
8. You may explain financial concepts, compare strategies, and provide frameworks
9. When uncertain, say so explicitly
10. All responses must be in Bahasa Indonesia

Financial context provided is for educational analysis only. Do not treat it as advice-ready data."""
```

Apply this system prompt in `chat_advisor()` function.

### 2. worker/app/services/ai_service.py — Tambah Disclaimer Wrapper

```python
def wrap_with_disclaimer(response: str) -> dict:
    disclaimer = ("⚠️ Informasi ini bersifat edukasi, bukan nasihat finansial. "
                   "Keputusan finansial material harus dikonsultasikan dengan "
                   "penasihat keuangan berlisensi.")
    return {
        "response": response,
        "disclaimer": disclaimer,
        "source": "ai_advisor",
        "timestamp": datetime.utcnow().isoformat(),
    }
```

### 3. worker/main.py — Tambah Response Headers

```python
@app.post("/ai/chat")
async def chat(...):
    # ... existing code ...
    result = await chat_advisor(...)
    wrapped = wrap_with_disclaimer(result.get("response", result))
    return wrapped
```

### 4. backend/internal/service/ai_settings_service.go — Audit Trail

Tambah logging setiap kali AI dipanggil:
```go
_, _ = s.dbPool.Exec(ctx, `
    INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
    VALUES ($1, 'ai_advisor', gen_random_uuid(), 'query', $2)
`, userID, map[string]interface{}{
    "provider":  provider,
    "model":     model,
    "timestamp": time.Now().UTC(),
})
```

## Acceptance Criteria

- [ ] System prompt guardrail diterapkan di `chat_advisor()`
- [ ] Semua response AI memiliki disclaimer
- [ ] Audit log tercatat setiap AI dipanggil
- [ ] Tidak ada response yang merekomendasikan produk spesifik
- [ ] Python compile clean
- [ ] Go build pass
