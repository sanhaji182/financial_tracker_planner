import os
from fastapi import FastAPI, UploadFile, File, HTTPException, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from app.services.ocr_service import process_ocr_receipt
from app.services.pdf_service import parse_pdf_mutasi

app = FastAPI(
    title="Financial OS - Python Worker",
    description="Worker service for OCR receipt processing, PDF bank statements, and cashflow forecast analysis.",
    version="1.0.0"
)

# CORS: restrict to known origins only (not wildcard with credentials)
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://localhost:8080").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Service-to-service authentication
WORKER_SECRET = os.getenv("WORKER_SECRET", "")

def verify_service_auth(x_worker_secret: str = Header(None)):
    """Verify service-to-service authentication when WORKER_SECRET is configured."""
    if WORKER_SECRET:
        if not x_worker_secret or x_worker_secret != WORKER_SECRET:
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

@app.post("/parse/pdf-statement")
async def parse_pdf_statement(
    file: UploadFile = File(...),
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
        res = parse_pdf_mutasi(file_bytes)
        return res
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to parse PDF statement")

# Pydantic schemas for AI endpoints
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from app.services.ai_service import enhance_ocr_llm, categorize_transaction, chat_advisor, detect_anomalies_rule

class EnhanceOCRRequest(BaseModel):
    ocr_result: Dict[str, Any]
    image_base64: str
    filename: str

class CategorizeRequest(BaseModel):
    description: str
    amount: float
    merchant: str
    available_categories: List[Dict[str, str]]

class ChatRequest(BaseModel):
    message: str
    context: Dict[str, Any]

class DetectAnomalyRequest(BaseModel):
    recent_transactions: List[Dict[str, Any]]
    category_averages: List[Dict[str, Any]]

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
            api_key=x_ai_api_key
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
            api_key=x_ai_api_key
        )
        return res
    except Exception:
        raise HTTPException(status_code=500, detail="Failed to process chat")

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
