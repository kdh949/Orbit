from __future__ import annotations

from io import BytesIO
import math
import wave

import numpy as np

from app.audio.analysis.decoder import decode_audio
from app.audio.models import AudioContent

MAXIMUM_CLIP_SECONDS = 60.0


def create_rehearsal_audio_clip(
    audio_content: AudioContent,
    start_seconds: float,
    end_seconds: float,
) -> bytes:
    if (
        not math.isfinite(start_seconds)
        or not math.isfinite(end_seconds)
        or start_seconds < 0
        or end_seconds <= start_seconds
        or end_seconds - start_seconds > MAXIMUM_CLIP_SECONDS
    ):
        raise ValueError("audio clip range is invalid")

    decoded_audio = decode_audio(audio_content)
    if start_seconds >= decoded_audio.duration_seconds:
        raise ValueError("audio clip starts after the recording ends")

    bounded_end_seconds = min(end_seconds, decoded_audio.duration_seconds)
    start_sample = round(start_seconds * decoded_audio.sample_rate_hz)
    end_sample = round(bounded_end_seconds * decoded_audio.sample_rate_hz)
    samples = decoded_audio.samples[start_sample:end_sample]
    if samples.size == 0:
        raise ValueError("audio clip is empty")

    pcm_samples = (np.clip(samples, -1.0, 1.0) * np.iinfo(np.int16).max).astype(
        "<i2", copy=False
    )
    output = BytesIO()
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(decoded_audio.sample_rate_hz)
        wav_file.writeframes(pcm_samples.tobytes())
    return output.getvalue()
