import hmac
import json
import os
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import StreamingResponse
from app.services.email_statement_service import parse_inbound_email_statement
from app.services.ocr_service import PDFPasswordError, extract_document_text, process_ocr_receipt
from app.services.pdf_service import parse_pdf_mutasi
from app.services.snapshot_service import (
    parse_account_snapshot,
    parse_debt_payment,
    parse_debt_snapshot,
)
from app.services.voice_service import transcribe_voice_note

app = FastAPI(
    title="Financial OS - Python Worker",
    description="Worker service for OCR receipt processing, PDF bank statements, and cashflow forecast analysis.",
    version="1.0.0"
)

# CORS: restrict to known origins only (not wildcard with credentials)
_raw_origins = os.getenv("CORS_ALLOWED_ORIGINS") or os.getenv("CORS_ORIGINS") or "http://localhost:5173,http://localhost:8080"
ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Service-to-service authentication (fail-closed in production + constant-time comparison)
WORKER_SECRET = os.getenv("WORKER_SECRET", "")

def verify_service_auth(x_worker_secret: str = Header(None)):
    """Verify service-to-service authentication using constant-time comparison (fail-closed in production)."""
    secret = (os.getenv("WORKER_SECRET") or WORKER_SECRET or "").strip()
    app_env = (os.getenv("APP_ENV") or "development").strip().lower()
    if not secret:
        if app_env == "production":
            raise HTTPException(
                status_code=503,
                detail="Service auth misconfigured: WORKER_SECRET is required in production",
            )
        return
    if not x_worker_secret or not hmac.compare_digest(
        x_worker_secret.encode("utf-8"), secret.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="Unauthorized: invalid service credentials")

# File size limits
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10MB

async def read_file_with_limit(file: UploadFile) -> bytes:
    """Read uploaded file with size limit to prevent memory exhaustion."""
    file_bytes = await file.read()
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File size exceeds 10MB limit")
    return file_bytes

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "worker"
    }

@app.post("/ocr/receipt")
async def ocr_receipt(
    file: UploadFile = File(...),
    x_worker_secret: str = Header(None)
):
    """
    Accepts an uploaded receipt image and extracts merchant_name, date, items, total, and payment method.
    """
    verify_service_auth(x_worker_secret)

    # Validate file type by content-type and extension
    content_type = file.content_type or ""
    filename_lower = (file.filename or "").lower()
    if not (content_type.startswith("image/") or filename_lower.endswith((".png", ".jpg", ".jpeg", ".webp"))):
        raise HTTPException(status_code=400, detail="Invalid file type. Must be an image (PNG, JPG, JPEG, WEBP)")

    try:
        file_bytes = await read_file_with_limit(file)
        res = process_ocr_receipt(file_bytes)
        return res
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to process receipt OCR")

def validate_image_or_pdf(file: UploadFile) -> None:
    content_type = file.content_type or ""
    filename_lower = (file.filename or "").lower()
    is_valid = (
        content_type.startswith("image/")
        or content_type == "application/pdf"
        or filename_lower.endswith((".png", ".jpg", ".jpeg", ".webp", ".pdf"))
    )
    if not is_valid:
        raise HTTPException(
            status_code=400,
            detail="Invalid file type. Must be an image (PNG, JPG, JPEG, WEBP) or PDF",
        )


@app.post("/ocr/document")
async def ocr_document(
    file: UploadFile = File(...),
    x_worker_secret: str = Header(None)
):
    """
    Accepts any image or PDF (digital or scanned) and extracts full OCR text.
    """
    verify_service_auth(x_worker_secret)
    validate_image_or_pdf(file)

    try:
        file_bytes = await read_file_with_limit(file)
        return extract_document_text(file_bytes, file.filename or "")
    except PDFPasswordError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to extract document OCR text")


@app.post("/parse/pdf-statement")
async def parse_pdf_statement(
    file: UploadFile = File(...),
    pdf_password: str = Form(None),
    x_worker_secret: str = Header(None)
):
    """
    Accepts an uploaded PDF bank statement and extracts list of transactions.
    """
    verify_service_auth(x_worker_secret)

    # Validate file type
    content_type = file.content_type or ""
    filename_lower = (file.filename or "").lower()
    if not (content_type == "application/pdf" or filename_lower.endswith(".pdf")):
        raise HTTPException(status_code=400, detail="Invalid file type. Must be a PDF")

    try:
        file_bytes = await read_file_with_limit(file)
        res = parse_pdf_mutasi(file_bytes, pdf_password=pdf_password)
        return res
    except PDFPasswordError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse PDF statement")


@app.post("/parse/debt-snapshot")
async def parse_debt_snapshot_endpoint(
    file: UploadFile = File(...),
    pdf_password: str = Form(None),
    x_worker_secret: str = Header(None),
    x_ai_provider: str = Header(None),
    x_ai_model: str = Header(None),
    x_ai_api_key: str = Header(None),
):
    """
    Accepts a PayLater / Credit Card / Loan screenshot or PDF statement and extracts debt fields.
    """
    verify_service_auth(x_worker_secret)
    validate_image_or_pdf(file)

    try:
        file_bytes = await read_file_with_limit(file)
        return await parse_debt_snapshot(
            file_bytes=file_bytes,
            filename=file.filename or "",
            pdf_password=pdf_password,
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key,
        )
    except PDFPasswordError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse debt snapshot")


@app.post("/parse/debt-payment")
async def parse_debt_payment_endpoint(
    file: UploadFile = File(...),
    pdf_password: str = Form(None),
    x_worker_secret: str = Header(None),
    x_ai_provider: str = Header(None),
    x_ai_model: str = Header(None),
    x_ai_api_key: str = Header(None),
):
    """
    Accepts a debt payment receipt screenshot or PDF and extracts payment details.
    """
    verify_service_auth(x_worker_secret)
    validate_image_or_pdf(file)

    try:
        file_bytes = await read_file_with_limit(file)
        return await parse_debt_payment(
            file_bytes=file_bytes,
            filename=file.filename or "",
            pdf_password=pdf_password,
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key,
        )
    except PDFPasswordError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse debt payment proof")


@app.post("/parse/account-snapshot")
async def parse_account_snapshot_endpoint(
    file: UploadFile = File(...),
    pdf_password: str = Form(None),
    x_worker_secret: str = Header(None),
    x_ai_provider: str = Header(None),
    x_ai_model: str = Header(None),
    x_ai_api_key: str = Header(None),
):
    """
    Accepts a bank/e-wallet balance screenshot or PDF statement and extracts account balance fields.
    """
    verify_service_auth(x_worker_secret)
    validate_image_or_pdf(file)

    try:
        file_bytes = await read_file_with_limit(file)
        return await parse_account_snapshot(
            file_bytes=file_bytes,
            filename=file.filename or "",
            pdf_password=pdf_password,
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key,
        )
    except PDFPasswordError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message})
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse account snapshot")

# Pydantic schemas for AI & inbound email endpoints
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from app.services.ai_service import (
    enhance_ocr_llm,
    categorize_transaction,
    chat_advisor,
    stream_chat_advisor,
    detect_anomalies_rule,
)

class EnhanceOCRRequest(BaseModel):
    ocr_result: Dict[str, Any]
    image_base64: str
    filename: str

class CategorizeRequest(BaseModel):
    description: str
    amount: float
    merchant: str
    available_categories: List[Dict[str, str]]

class ChatAttachmentItem(BaseModel):
    name: str = ""
    mime_type: str = "image/jpeg"
    data_base64: str = ""

class ChatRequest(BaseModel):
    message: str = ""
    context: Dict[str, Any] = {}
    history: List[Dict[str, str]] = []
    attachments: List[ChatAttachmentItem] = []
    preferences: Dict[str, Any] = {}

class DetectAnomalyRequest(BaseModel):
    recent_transactions: List[Dict[str, Any]]
    category_averages: List[Dict[str, Any]]

class EmailAttachmentItem(BaseModel):
    filename: str = ""
    content_type: str = "application/pdf"
    content_base64: str = ""

class EmailStatementRequest(BaseModel):
    subject: str = ""
    sender: str = ""
    body_text: str = ""
    body_html: str = ""
    attachments: List[EmailAttachmentItem] = []
    pdf_password: Optional[str] = None

@app.post("/ai/enhance-ocr")
async def enhance_ocr(
    req: EnhanceOCRRequest,
    x_worker_secret: str = Header(None),
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None)
):
    verify_service_auth(x_worker_secret)
    try:
        res = await enhance_ocr_llm(
            ocr_result=req.ocr_result,
            image_base64=req.image_base64,
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key,
            filename=req.filename,
        )
        return res
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to enhance OCR")

@app.post("/ai/categorize")
async def categorize(
    req: CategorizeRequest,
    x_worker_secret: str = Header(None),
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None)
):
    verify_service_auth(x_worker_secret)
    try:
        res = await categorize_transaction(
            description=req.description,
            amount=req.amount,
            merchant=req.merchant,
            available_categories=req.available_categories,
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key
        )
        return res
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to auto-categorize")

@app.post("/ai/chat")
async def chat(
    req: ChatRequest,
    x_worker_secret: str = Header(None),
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None)
):
    verify_service_auth(x_worker_secret)
    try:
        res = await chat_advisor(
            message=req.message,
            context_data=req.context,
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key,
            history=req.history,
            attachments=[a.model_dump() for a in req.attachments] if req.attachments else None,
            preferences=req.preferences or None,
        )
        return res
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to process chat")

@app.post("/ai/chat/stream")
async def chat_stream(
    req: ChatRequest,
    x_worker_secret: str = Header(None),
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None)
):
    verify_service_auth(x_worker_secret)
    return StreamingResponse(
        stream_chat_advisor(
            message=req.message,
            context_data=req.context,
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key,
            history=req.history,
            attachments=[a.model_dump() for a in req.attachments] if req.attachments else None,
            preferences=req.preferences or None,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

@app.post("/ai/transcribe-voice")
async def transcribe_voice_endpoint(
    file: UploadFile = File(...),
    context_json: Optional[str] = Form(None),
    x_worker_secret: str = Header(None),
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None),
):
    verify_service_auth(x_worker_secret)
    content_type = (file.content_type or "").lower()
    filename_lower = (file.filename or "").lower()
    valid_ext = (".webm", ".ogg", ".opus", ".mp3", ".m4a", ".mp4", ".wav", ".txt")
    if not (
        content_type.startswith("audio/")
        or content_type.startswith("text/")
        or content_type == "video/webm"
        or filename_lower.endswith(valid_ext)
    ):
        raise HTTPException(status_code=400, detail="Invalid file type. Must be audio or text transcript.")

    audio_bytes = await read_file_with_limit(file)
    parsed_ctx: Dict[str, Any] = {}
    if context_json:
        try:
            loaded = json.loads(context_json)
            if isinstance(loaded, dict):
                parsed_ctx = loaded
        except Exception:
            parsed_ctx = {}

    try:
        return await transcribe_voice_note(
            audio_bytes=audio_bytes,
            filename=file.filename or "voice-note.webm",
            mime_type=content_type or "audio/webm",
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key,
            context=parsed_ctx,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to transcribe voice note")

@app.post("/parse/email-statement")
async def parse_email_statement_endpoint(
    req: EmailStatementRequest,
    x_worker_secret: str = Header(None),
):
    verify_service_auth(x_worker_secret)
    try:
        return parse_inbound_email_statement(
            subject=req.subject,
            sender=req.sender,
            body_text=req.body_text,
            body_html=req.body_html,
            attachments=[a.model_dump() for a in req.attachments],
            pdf_password=req.pdf_password,
        )
    except PDFPasswordError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code, "message": exc.message})
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse email statement")

@app.post("/ai/detect-anomaly")
async def detect_anomaly(
    req: DetectAnomalyRequest,
    x_worker_secret: str = Header(None),
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None)
):
    verify_service_auth(x_worker_secret)
    try:
        res = detect_anomalies_rule(
            recent_transactions=req.recent_transactions,
            category_averages=req.category_averages
        )
        return res
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to detect anomalies")
