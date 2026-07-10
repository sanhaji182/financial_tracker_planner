from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from app.services.ocr_service import process_ocr_receipt
from app.services.pdf_service import parse_pdf_mutasi

app = FastAPI(
    title="Financial OS - Python Worker",
    description="Worker service for OCR receipt processing, PDF bank statements, and cashflow forecast analysis.",
    version="1.0.0"
)

# Setup CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "worker"
    }

@app.get("/")
async def root():
    return {
        "message": "Financial OS Worker is running.",
        "docs": "/docs"
    }

@app.post("/ocr/receipt")
async def ocr_receipt(file: UploadFile = File(...)):
    """
    Accepts an uploaded receipt image and extracts merchant_name, date, items, total, and payment method.
    """
    # Validate file extension
    content_type = file.content_type or ""
    if not (content_type.startswith("image/") or file.filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp"))):
        raise HTTPException(status_code=400, detail="Invalid file type. Must be an image (PNG, JPG, JPEG, WEBP)")
        
    try:
        file_bytes = await file.read()
        res = process_ocr_receipt(file_bytes)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process receipt OCR: {str(e)}")

@app.post("/parse/pdf-statement")
async def parse_pdf_statement(file: UploadFile = File(...)):
    """
    Accepts an uploaded PDF bank statement and extracts list of transactions.
    """
    # Validate file extension
    content_type = file.content_type or ""
    if not (content_type == "application/pdf" or file.filename.lower().endswith(".pdf")):
        raise HTTPException(status_code=400, detail="Invalid file type. Must be a PDF")
        
    try:
        file_bytes = await file.read()
        res = parse_pdf_mutasi(file_bytes)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF statement: {str(e)}")

# Pydantic schemas for AI endpoints
from pydantic import BaseModel
from typing import Dict, Any, List, Optional
from fastapi import Header
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
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None)
):
    try:
        res = await enhance_ocr_llm(
            ocr_result=req.ocr_result,
            image_base64=req.image_base64,
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to enhance OCR: {str(e)}")

@app.post("/ai/categorize")
async def categorize(
    req: CategorizeRequest,
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None)
):
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
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to auto-categorize: {str(e)}")

@app.post("/ai/chat")
async def chat(
    req: ChatRequest,
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None)
):
    try:
        res = await chat_advisor(
            message=req.message,
            context_data=req.context,
            provider=x_ai_provider or "local",
            model_name=x_ai_model or "default",
            api_key=x_ai_api_key
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process chat: {str(e)}")

@app.post("/ai/detect-anomaly")
async def detect_anomaly(
    req: DetectAnomalyRequest,
    x_ai_provider: Optional[str] = Header(None),
    x_ai_model: Optional[str] = Header(None),
    x_ai_api_key: Optional[str] = Header(None)
):
    try:
        # Note: detect_anomalies_rule is synchronous, which is fine to call in async handler
        res = detect_anomalies_rule(
            recent_transactions=req.recent_transactions,
            category_averages=req.category_averages
        )
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to detect anomalies: {str(e)}")

