from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
