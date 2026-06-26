import io
import logging
import os
import sys
from contextlib import asynccontextmanager

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import engine, get_db, Base, DATABASE_URL
from models import Meeting

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

whisper: WhisperModel | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global whisper

    # ── Database ────────────────────────────────────────────────────────────
    safe_url = DATABASE_URL.split("@")[-1] if "@" in DATABASE_URL else DATABASE_URL
    logger.info(f"  🗄️   Connecting to database  →  {safe_url}")
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("  ✅  Database connected & tables ready")
    except Exception as e:
        logger.error("")
        logger.error("  ╔══════════════════════════════════════════════════╗")
        logger.error("  ║  ❌  DATABASE CONNECTION FAILED                  ║")
        logger.error(f"  ║     {str(e)[:48]:<48} ║")
        logger.error("  ╠══════════════════════════════════════════════════╣")
        logger.error("  ║  👉  Check your credentials in backend/.env      ║")
        logger.error("  ╚══════════════════════════════════════════════════╝")
        logger.error("")
        raise

    # ── Whisper model ────────────────────────────────────────────────────────
    logger.info("  🎙️   Loading Whisper 'base' model on CPU  (first run ~74 MB download)...")
    whisper = WhisperModel("base", device="cpu", compute_type="int8")
    logger.info("  ✅  Whisper model ready")
    logger.info("")
    logger.info("  ┌─────────────────────────────────────────────────┐")
    logger.info("  │  🚀  EchoNotes backend running on :8000         │")
    logger.info("  │  📡  API docs → http://127.0.0.1:8000/docs      │")
    logger.info("  └─────────────────────────────────────────────────┘")
    logger.info("")

    yield

    logger.info("  🛑  Shutting down — closing database connections...")
    await engine.dispose()


app = FastAPI(title="EchoNotes Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    title: str = Form(""),
    duration_s: int = Form(0),
    db: AsyncSession = Depends(get_db),
):
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file.")

    logger.info(f"Transcribing {len(audio_bytes) // 1024} KB  title='{title}'  duration={duration_s}s")

    segments, info = whisper.transcribe(
        io.BytesIO(audio_bytes),
        beam_size=5,
        language=None,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )
    full_text = " ".join(seg.text.strip() for seg in segments)
    logger.info(f"Transcription done — language: {info.language} ({info.language_probability:.0%}), {len(full_text)} chars")

    meeting = Meeting(title=title or "Untitled Meeting", duration_s=duration_s, transcript=full_text)
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)
    logger.info(f"Meeting saved — id={meeting.id}")

    return {
        "id": meeting.id,
        "title": meeting.title,
        "created_at": meeting.created_at.isoformat(),
        "duration_s": meeting.duration_s,
        "transcript": meeting.transcript,
    }


@app.get("/meetings")
async def list_meetings(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).order_by(Meeting.created_at.desc()))
    meetings = result.scalars().all()
    return [
        {
            "id": m.id,
            "title": m.title,
            "created_at": m.created_at.isoformat(),
            "duration_s": m.duration_s,
            "has_transcript": bool(m.transcript),
            "has_minutes": bool(m.minutes),
        }
        for m in meetings
    ]


@app.get("/meetings/{meeting_id}")
async def get_meeting(meeting_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    return {
        "id": meeting.id,
        "title": meeting.title,
        "created_at": meeting.created_at.isoformat(),
        "duration_s": meeting.duration_s,
        "transcript": meeting.transcript,
        "minutes": meeting.minutes,
    }
