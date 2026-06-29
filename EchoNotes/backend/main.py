import asyncio
import importlib.util
import io
import logging
import os
import sys
import threading
import uuid
from contextlib import asynccontextmanager

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

# Check package availability without importing — avoids 60-120s PyTorch init at startup
_DIARIZE_AVAILABLE = all(
    importlib.util.find_spec(pkg) is not None
    for pkg in ("torch", "numpy", "speechbrain", "pydub", "sklearn")
)

import httpx

from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Depends, Response
from fastapi.middleware.cors import CORSMiddleware
from faster_whisper import WhisperModel
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from database import engine, get_db, Base, DATABASE_URL
from models import Meeting

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL    = os.getenv("OLLAMA_MODEL", "llama3.2:1b")
WHISPER_MODEL   = os.getenv("WHISPER_MODEL", "small")

whisper: WhisperModel | None = None
speaker_encoder = None
whisper_load_failed = False
loading_status = "Starting up…"

# In-memory job store — keyed by UUID string
_jobs: dict = {}


def _load_models_thread():
    global whisper, speaker_encoder, whisper_load_failed, loading_status

    loading_status = f"Loading speech recognition model (Whisper {WHISPER_MODEL})…"
    logger.info(f"  🎙️   Loading Whisper '{WHISPER_MODEL}' model on CPU...")
    try:
        whisper = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")
        logger.info("  ✅  Whisper model ready")
    except Exception as e:
        whisper_load_failed = True
        loading_status = f"Whisper failed: {e}"
        logger.error(f"  ❌  Whisper failed to load: {e}")
        return

    if _DIARIZE_AVAILABLE:
        loading_status = "Loading speaker identification model (first run ~80 MB download)…"
        logger.info("  🔊  Loading speaker encoder...")
        try:
            import torch  # noqa: F401 — needed by speechbrain
            from speechbrain.pretrained import EncoderClassifier
            speaker_encoder = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                run_opts={"device": "cpu"},
            )
            logger.info("  ✅  Speaker encoder ready")
        except Exception as e:
            logger.warning(f"  ⚠️   Speaker encoder unavailable: {e}")
    else:
        logger.info("  ℹ️   speechbrain not installed — diarization disabled")

    loading_status = "Ready"
    logger.info("  🟢  All models loaded")


@asynccontextmanager
async def lifespan(app: FastAPI):
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

    logger.info("")
    logger.info("  ┌─────────────────────────────────────────────────┐")
    logger.info("  │  🚀  EchoNotes backend running on :8000         │")
    logger.info("  │  📡  API docs → http://127.0.0.1:8000/docs      │")
    logger.info("  │  ⏳  AI models loading in background…           │")
    logger.info("  └─────────────────────────────────────────────────┘")
    logger.info("")

    # Models load in a background thread — server is available immediately.
    # /transcribe returns 503 until whisper is ready (already handled).
    threading.Thread(target=_load_models_thread, daemon=True, name="model-loader").start()

    yield

    logger.info("  🛑  Shutting down — closing database connections...")
    await engine.dispose()


def _assign_speakers(audio_bytes: bytes, segments: list) -> str:
    """Extract per-segment speaker embeddings, cluster them, and label each segment."""
    import numpy as np
    import torch
    from pydub import AudioSegment
    from sklearn.cluster import AgglomerativeClustering

    # format=None lets pydub auto-detect (webm, mp3, mp4, m4a, wav all work)
    audio = AudioSegment.from_file(io.BytesIO(audio_bytes), format=None)
    audio = audio.set_channels(1).set_frame_rate(16000)
    samples = np.array(audio.get_array_of_samples(), dtype=np.float32) / 32768.0

    embeddings = []
    for seg in segments:
        start = int(seg.start * 16000)
        end = int(seg.end * 16000)
        chunk = samples[start:end]
        if len(chunk) < 400:
            embeddings.append(None)
            continue
        wav = torch.tensor(chunk).unsqueeze(0)
        with torch.no_grad():
            emb = speaker_encoder.encode_batch(wav)
        embeddings.append(emb.squeeze().numpy())

    valid = [e for e in embeddings if e is not None]
    if not valid:
        return " ".join(seg.text.strip() for seg in segments)

    zero = np.zeros_like(valid[0])
    matrix = np.stack([e if e is not None else zero for e in embeddings])

    if len(matrix) < 2:
        return f"SPEAKER_00: {segments[0].text.strip()}"

    clustering = AgglomerativeClustering(
        n_clusters=None, distance_threshold=0.4, metric="cosine", linkage="average"
    )
    labels = clustering.fit_predict(matrix)

    return "\n".join(
        f"SPEAKER_{label:02d}: {seg.text.strip()}"
        for seg, label in zip(segments, labels)
    )


async def _run_transcription(
    job_id: str, audio_bytes: bytes, title: str, duration_s: int, language: str
) -> None:
    """Async task: transcribe audio and save the meeting, updating _jobs throughout."""
    _jobs[job_id]["status"] = "processing"

    try:
        def _do_transcribe():
            segs_gen, info = whisper.transcribe(
                io.BytesIO(audio_bytes),
                beam_size=10,
                language=language or None,
                vad_filter=True,
                vad_parameters=dict(min_silence_duration_ms=300),
                word_timestamps=True,
                temperature=0,
            )
            return list(segs_gen), info  # materialise generator inside thread

        logger.info(f"  Job {job_id[:8]} — running Whisper ({len(audio_bytes) // 1024} KB)…")
        segments, info = await asyncio.to_thread(_do_transcribe)

        if speaker_encoder is not None:
            try:
                full_text = await asyncio.to_thread(_assign_speakers, audio_bytes, segments)
            except Exception as e:
                logger.warning(f"  Diarization failed, using plain transcript: {e}")
                full_text = " ".join(seg.text.strip() for seg in segments)
        else:
            full_text = " ".join(seg.text.strip() for seg in segments)

        logger.info(
            f"  Job {job_id[:8]} — done  language={info.language} "
            f"({info.language_probability:.0%})  {len(full_text)} chars"
        )

        async with AsyncSession(engine) as db:
            meeting = Meeting(title=title or "Untitled Meeting", duration_s=duration_s, transcript=full_text)
            db.add(meeting)
            await db.commit()
            await db.refresh(meeting)

        _jobs[job_id]["status"] = "done"
        _jobs[job_id]["result"] = {
            "id": meeting.id,
            "title": meeting.title,
            "created_at": meeting.created_at.isoformat(),
            "duration_s": meeting.duration_s,
            "transcript": meeting.transcript,
        }

    except Exception as e:
        logger.error(f"  Job {job_id[:8]} — failed: {e}")
        _jobs[job_id]["status"] = "error"
        _jobs[job_id]["error"] = str(e)


app = FastAPI(title="EchoNotes Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "DELETE", "PATCH"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "whisper_ready": whisper is not None,
        "whisper_failed": whisper_load_failed,
        "diarization_ready": speaker_encoder is not None,
        "loading_status": loading_status,
    }


@app.post("/transcribe", status_code=202)
async def transcribe(
    file: UploadFile = File(...),
    title: str = Form(""),
    duration_s: int = Form(0),
    language: str = Form(""),
):
    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio file.")
    if len(audio_bytes) > 200 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio file too large (max 200 MB).")
    if whisper is None:
        raise HTTPException(status_code=503, detail="Transcription model is not ready yet.")

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "pending", "result": None, "error": None}
    asyncio.create_task(_run_transcription(job_id, audio_bytes, title, duration_s, language))

    logger.info(f"  Job {job_id[:8]} — queued  title='{title}'  lang='{language or 'auto'}'")
    return {"job_id": job_id}


@app.get("/transcribe/{job_id}")
def get_transcribe_job(job_id: str):
    job = _jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {
        "status": job["status"],
        "result": job["result"],
        "error": job["error"],
    }


class MeetingPatch(BaseModel):
    title: Optional[str] = None
    transcript: Optional[str] = None


@app.get("/meetings")
async def list_meetings(q: str = "", db: AsyncSession = Depends(get_db)):
    try:
        stmt = select(Meeting).order_by(Meeting.created_at.desc())
        if q:
            pattern = f"%{q}%"
            stmt = stmt.where(or_(Meeting.title.ilike(pattern), Meeting.transcript.ilike(pattern)))
        result = await db.execute(stmt)
        meetings = result.scalars().all()
    except Exception as e:
        logger.error(f"Failed to list meetings: {e}")
        raise HTTPException(status_code=503, detail="Could not load meetings. Is the database running?")
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


@app.delete("/meetings/{meeting_id}", status_code=204)
async def delete_meeting(meeting_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    await db.delete(meeting)
    await db.commit()
    logger.info(f"Meeting deleted — id={meeting_id}")
    return Response(status_code=204)


@app.patch("/meetings/{meeting_id}")
async def patch_meeting(meeting_id: int, patch: MeetingPatch, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    if patch.title is not None:
        meeting.title = patch.title
    if patch.transcript is not None:
        meeting.transcript = patch.transcript
        meeting.minutes = None  # invalidate stale minutes when transcript changes
    await db.commit()
    await db.refresh(meeting)
    logger.info(f"Meeting patched — id={meeting_id}")
    return {
        "id": meeting.id,
        "title": meeting.title,
        "created_at": meeting.created_at.isoformat(),
        "duration_s": meeting.duration_s,
        "transcript": meeting.transcript,
        "minutes": meeting.minutes,
    }


@app.post("/meetings/{meeting_id}/minutes")
async def generate_minutes(meeting_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Meeting).where(Meeting.id == meeting_id))
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(status_code=404, detail="Meeting not found.")
    if not meeting.transcript or not meeting.transcript.strip():
        raise HTTPException(status_code=422, detail="Cannot generate minutes: meeting has no transcript.")

    prompt = f"""You are a professional meeting minutes assistant. Generate clear, concise meeting minutes from the transcript below.

Format your response as Markdown with exactly these sections:
## Summary
(2-3 sentences)

## Key Discussion Points
- bullet points

## Action Items
- bullet points, or "None identified" if none

## Decisions Made
- bullet points, or "None identified" if none

Keep it factual, professional, and based only on what was discussed.

Transcript:
{meeting.transcript}"""

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/generate",
                json={"model": OLLAMA_MODEL, "prompt": prompt, "stream": False},
            )
            response.raise_for_status()
            minutes_text = response.json()["response"]
    except httpx.ConnectError:
        raise HTTPException(
            status_code=503,
            detail=f"Ollama is not running. Install from https://ollama.com then run: ollama pull {OLLAMA_MODEL}",
        )
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=502, detail=f"Ollama error: {e.response.status_code}")

    meeting.minutes = minutes_text
    await db.commit()
    await db.refresh(meeting)
    logger.info(f"Minutes generated — id={meeting_id}, {len(minutes_text)} chars")

    return {
        "id": meeting.id,
        "title": meeting.title,
        "created_at": meeting.created_at.isoformat(),
        "duration_s": meeting.duration_s,
        "transcript": meeting.transcript,
        "minutes": meeting.minutes,
    }
