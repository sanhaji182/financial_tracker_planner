# P3: AI Advisor Guardrails

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safety guardrails to the AI advisor to prevent harmful financial advice, add disclaimers, and create an audit trail.

**Architecture:** Add system prompt guardrails to the Python worker's AI service, wrap all responses with disclaimers, and add audit logging on the Go backend side.

**Tech Stack:** Python (FastAPI worker), Go (backend audit logging), PostgreSQL

## Global Constraints

- All AI responses must include disclaimer in Bahasa Indonesia
- System prompt must prevent specific product recommendations
- Audit log every AI query for compliance
- Python compile must be clean
- Go build must pass
- No breaking changes to existing API contract

---

### Task 1: Add System Prompt Guardrail to AI Service

**Files:**
- Modify: `worker/app/services/ai_service.py`

**Interfaces:**
- Produces: `ADVISOR_SYSTEM_PROMPT` constant, `wrap_with_disclaimer()` function

- [ ] **Step 1: Add the guardrail system prompt constant**

Add at the top of `worker/app/services/ai_service.py`:

```python
# Guardrail system prompt for AI Advisor
ADVISOR_SYSTEM_PROMPT = """You are a personal finance education assistant, NOT a licensed financial advisor.

IMPORTANT RULES:
1. NEVER recommend specific stocks, funds, or investment products by name
2. NEVER predict specific returns or guarantee outcomes
3. ALWAYS include this disclaimer when giving financial guidance:
   "Ini adalah informasi edukasi, bukan nasihat finansial. Konsultasikan dengan penasihat keuangan berlisensi."
4. NEVER help with tax evasion, fraud, or illegal financial activities
5. NEVER suggest specific insurance products by name/brand
6. DO NOT make assumptions about user's risk tolerance - ask first
7. ALWAYS suggest consulting a professional for decisions above Rp 50,000,000
8. You may explain financial concepts, compare strategies, and provide frameworks
9. When uncertain, say so explicitly
10. All responses must be in Bahasa Indonesia

Financial context provided is for educational analysis only. Do not treat it as advice-ready data.
If the user asks for specific investment recommendations, explain the general principles instead and recommend consulting a licensed financial advisor."""
```

- [ ] **Step 2: Add disclaimer wrapper function**

```python
from datetime import datetime

def wrap_with_disclaimer(response: str) -> dict:
    """Wraps AI response with mandatory disclaimer and metadata."""
    disclaimer = (
        "⚠️ Informasi ini bersifat edukasi, bukan nasihat finansial. "
        "Keputusan finansial material harus dikonsultasikan dengan "
        "penasihat keuangan berlisensi."
    )
    return {
        "response": response,
        "disclaimer": disclaimer,
        "source": "ai_advisor",
        "timestamp": datetime.utcnow().isoformat(),
    }
```

- [ ] **Step 3: Update chat_advisor function to use guardrail prompt**

In the `chat_advisor()` function, replace the existing system_prompt with the guardrail version:

```python
async def chat_advisor(
    message: str,
    context_data: Dict[str, Any],
    provider: str,
    model_name: str,
    api_key: Optional[str]
) -> Dict[str, Any]:
    """
    Chats with the AI Financial Advisor with guardrails applied.
    """
    # ... existing context extraction code ...
    
    # Use the guardrail system prompt combined with context
    system_prompt = ADVISOR_SYSTEM_PROMPT + "\n\n" + (
        f"User's Financial Context (for educational analysis only):\n{context_str}\n\n"
        "Remember: You are providing financial education, not advice. "
        "Never recommend specific products. Always include disclaimers."
    )

    # ... rest of existing code for API calls ...
```

- [ ] **Step 4: Update return to use wrap_with_disclaimer**

At the end of `chat_advisor()`, wrap the response:

```python
    # For mock responses:
    if not api_key or provider == "local":
        mock_result = generate_mock_chat_response(message, context_data)
        return wrap_with_disclaimer(mock_result.get("response", ""))
    
    # For real API responses:
    try:
        # ... existing API call code ...
        result = parse_advisor_response(content)
        return wrap_with_disclaimer(result.get("response", ""))
    except Exception as e:
        logger.error(f"Error calling provider: {str(e)}")
        mock_result = generate_mock_chat_response(message, context_data)
        return wrap_with_disclaimer(mock_result.get("response", ""))
```

- [ ] **Step 5: Verify Python compiles cleanly**

Run: `cd /Volumes/Backup/php/financial_planning/worker && python3 -m compileall -q app/services/ai_service.py`
Expected: No output (clean compile)

- [ ] **Step 6: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add worker/app/services/ai_service.py
git commit -m "feat(worker): add AI advisor guardrails and disclaimer wrapper"
```

---

### Task 2: Update Worker Endpoint to Return Disclaimers

**Files:**
- Modify: `worker/main.py`

**Interfaces:**
- Consumes: `wrap_with_disclaimer()` from Task 1
- Produces: Updated `/ai/chat` endpoint response format

- [ ] **Step 1: Update the /ai/chat endpoint**

In `worker/main.py`, update the chat endpoint to use the wrapper:

```python
from app.services.ai_service import chat_advisor, wrap_with_disclaimer

@app.post("/ai/chat")
async def chat(request: Request):
    body = await request.json()
    message = body.get("message", "")
    context_data = body.get("context", {})
    provider = body.get("provider", "local")
    model_name = body.get("model", "default")
    api_key = body.get("api_key")
    
    result = await chat_advisor(
        message=message,
        context_data=context_data,
        provider=provider,
        model_name=model_name,
        api_key=api_key
    )
    
    # Response already wrapped by chat_advisor with disclaimer
    return result
```

- [ ] **Step 2: Verify Python compiles cleanly**

Run: `cd /Volumes/Backup/php/financial_planning/worker && python3 -m compileall -q main.py`
Expected: No output (clean compile)

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add worker/main.py
git commit -m "feat(worker): ensure /ai/chat endpoint returns wrapped response with disclaimer"
```

---

### Task 3: Add Audit Trail in Backend

**Files:**
- Modify: `backend/internal/service/ai_settings_service.go`

**Interfaces:**
- Produces: Audit log entries in `audit_logs` table

- [ ] **Step 1: Add audit logging to CallWorkerAI**

In `backend/internal/service/ai_settings_service.go`, add audit logging after each AI call:

```go
func (s *aiSettingsService) CallWorkerAI(ctx context.Context, userID string, req WorkerAIRequest) (*WorkerAIResponse, error) {
    // ... existing code to call worker ...
    
    // After successful call, log to audit trail
    auditData := map[string]interface{}{
        "provider":  req.Provider,
        "model":     req.Model,
        "timestamp": time.Now().UTC(),
        "message_length": len(req.Message),
    }
    auditJSON, _ := json.Marshal(auditData)
    
    _, err = s.dbPool.Exec(ctx, `
        INSERT INTO audit_logs (user_id, entity_type, entity_id, action, new_value)
        VALUES ($1, 'ai_advisor', gen_random_uuid(), 'query', $2)
    `, userID, string(auditJSON))
    if err != nil {
        // Log but don't fail the request
        log.Error().Err(err).Msg("Failed to write AI audit log")
    }
    
    return response, nil
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./...`

- [ ] **Step 3: Commit**

```bash
cd /Volumes/Backup/php/financial_planning
git add backend/internal/service/ai_settings_service.go
git commit -m "feat(backend): add audit trail for AI advisor queries"
```

---

### Task 4: Final Verification

- [ ] **Step 1: Verify Python compiles**

Run: `cd /Volumes/Backup/php/financial_planning/worker && python3 -m compileall -q .`

- [ ] **Step 2: Verify Go builds**

Run: `cd /Volumes/Backup/php/financial_planning/backend && go build ./... && go vet ./...`

- [ ] **Step 3: Test the guardrails manually**

Create a simple test script to verify disclaimers appear:

```python
# test_guardrails.py
import asyncio
from app.services.ai_service import chat_advisor

async def test():
    result = await chat_advisor(
        message="Apa kondisi keuangan saya?",
        context_data={"dashboard": {"net_worth": 1000000}},
        provider="local",
        model_name="default",
        api_key=None
    )
    print("Response keys:", result.keys())
    assert "disclaimer" in result, "Missing disclaimer!"
    assert "response" in result, "Missing response!"
    print("✅ Guardrails working correctly")
    print("Disclaimer:", result["disclaimer"])

asyncio.run(test())
```

- [ ] **Step 4: Final commit if any fixes needed**

```bash
cd /Volumes/Backup/php/financial_planning
git add -A
git commit -m "feat: complete AI advisor guardrails implementation"
```
