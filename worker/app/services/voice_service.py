import base64
import logging
import os
from typing import Any, Dict, List, Optional

import httpx

from app.services.ai_service import (
    openai_compatible_base_url,
    parse_indonesian_action_command,
    parse_indonesian_amount,
)

logger = logging.getLogger("worker.voice")


def _build_voice_result(
    transcript: str,
    provider: str,
    context: Optional[Dict[str, Any]] = None,
    needs_manual: bool = False,
    audio_bytes_len: int = 0,
    mime_type: str = "",
) -> Dict[str, Any]:
    clean = (transcript or "").strip()
    ctx = context or {}
    accounts = ctx.get("accounts") or []
    categories = ctx.get("categories") or []

    proposed_actions: List[Dict[str, Any]] = []
    parsed_amount = 0.0

    if clean:
        parsed_amount = float(parse_indonesian_amount(clean))
        action = parse_indonesian_action_command(clean, accounts, categories)
        if action is None and parsed_amount > 0 and accounts:
            # Voice notes often omit explicit verb ("kopi kenangan 28rb bca"):
            # retry as transaction command so user gets a ready-to-confirm action card.
            action = parse_indonesian_action_command(f"catat {clean}", accounts, categories)
        if action is not None:
            proposed_actions.append(action)

    res: Dict[str, Any] = {
        "transcript": clean,
        "provider": provider or "local",
        "needs_manual_transcript": bool(needs_manual or not clean),
        "parsed_amount": parsed_amount,
        "proposed_actions": proposed_actions,
    }
    if audio_bytes_len:
        res["audio_bytes"] = audio_bytes_len
    if mime_type:
        res["mime_type"] = mime_type
    return res


async def transcribe_voice_note(
    audio_bytes: bytes,
    filename: str = "voice-note.webm",
    mime_type: str = "audio/webm",
    provider: str = "local",
    model_name: str = "default",
    api_key: Optional[str] = None,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Transcribes an uploaded Indonesian voice note audio (OpenAI Whisper / Gemini Audio),
    falling back gracefully to UTF-8 text decode (for .txt/text/*) or manual-transcript prompt
    when offline/unconfigured. Extracts amount and agentic proposed_actions from transcript.
    """
    if not audio_bytes:
        raise ValueError("Audio file is empty")

    lower_name = (filename or "").lower()
    norm_mime = (mime_type or "audio/webm").split(";", 1)[0].strip().lower()

    # Deterministic plain-text fallback (used when Web Speech sends transcript or in tests)
    if norm_mime.startswith("text/") or lower_name.endswith(".txt"):
        decoded = audio_bytes.decode("utf-8", errors="ignore").strip()
        return _build_voice_result(
            transcript=decoded,
            provider=provider or "local",
            context=context,
            needs_manual=not bool(decoded),
            audio_bytes_len=len(audio_bytes),
            mime_type=norm_mime,
        )

    prov = (provider or "local").lower().strip()
    if prov == "openai" and api_key:
        try:
            url = f"{openai_compatible_base_url()}/audio/transcriptions"
            whisper_model = (
                os.getenv("OPENAI_TRANSCRIBE_MODEL")
                or ("gpt-4o-mini-transcribe" if "transcribe" in (model_name or "") else "whisper-1")
            )
            headers = {"Authorization": f"Bearer {api_key}"}
            files = {
                "file": (filename or "voice-note.webm", audio_bytes, norm_mime or "audio/webm"),
            }
            data = {
                "model": whisper_model,
                "language": "id",
                "response_format": "json",
            }
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(url, headers=headers, files=files, data=data)
                resp.raise_for_status()
                transcript = str(resp.json().get("text") or "").strip()
                if transcript:
                    return _build_voice_result(
                        transcript=transcript,
                        provider="openai",
                        context=context,
                        audio_bytes_len=len(audio_bytes),
                        mime_type=norm_mime,
                    )
        except Exception as exc:
            logger.warning("OpenAI Whisper transcription failed: %s", exc)

    if prov == "gemini" and api_key:
        try:
            llm_model = model_name if model_name and model_name != "default" else "gemini-2.5-flash"
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{llm_model}:generateContent?key={api_key}"
            audio_b64 = base64.b64encode(audio_bytes).decode("ascii")
            payload = {
                "contents": [
                    {
                        "parts": [
                            {
                                "text": (
                                    "Transkripsikan rekaman suara keuangan bahasa Indonesia ini "
                                    "secara akurat dan ringkas tanpa komentar tambahan."
                                )
                            },
                            {
                                "inline_data": {
                                    "mime_type": norm_mime or "audio/webm",
                                    "data": audio_b64,
                                }
                            },
                        ]
                    }
                ],
                "generationConfig": {"temperature": 0.1},
            }
            async with httpx.AsyncClient(timeout=45.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
                candidates = resp.json().get("candidates") or []
                transcript = ""
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts") or []
                    transcript = " ".join(str(p.get("text") or "") for p in parts).strip()
                if transcript:
                    return _build_voice_result(
                        transcript=transcript,
                        provider="gemini",
                        context=context,
                        audio_bytes_len=len(audio_bytes),
                        mime_type=norm_mime,
                    )
        except Exception as exc:
            logger.warning("Gemini audio transcription failed: %s", exc)

    # Graceful offline/no-key fallback
    return _build_voice_result(
        transcript="",
        provider=prov or "local",
        context=context,
        needs_manual=True,
        audio_bytes_len=len(audio_bytes),
        mime_type=norm_mime,
    )
