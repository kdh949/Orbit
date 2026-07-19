from io import BytesIO
import wave

import numpy as np
import pytest

from app.audio.clip import create_rehearsal_audio_clip
from app.audio.models import AudioContent

SAMPLE_RATE_HZ = 16_000


def test_create_rehearsal_audio_clip_returns_requested_wav_segment() -> None:
    seconds = 4
    timeline = np.arange(SAMPLE_RATE_HZ * seconds, dtype=np.float32) / SAMPLE_RATE_HZ
    samples = (0.2 * np.sin(2 * np.pi * 440 * timeline)).astype(np.float32)

    clip_bytes = create_rehearsal_audio_clip(
        _wav_audio_content(samples),
        start_seconds=1.25,
        end_seconds=3.5,
    )

    with wave.open(BytesIO(clip_bytes), "rb") as clip:
        assert clip.getnchannels() == 1
        assert clip.getframerate() == SAMPLE_RATE_HZ
        assert clip.getsampwidth() == 2
        assert clip.getnframes() == round(2.25 * SAMPLE_RATE_HZ)


def test_create_rehearsal_audio_clip_rejects_invalid_ranges() -> None:
    audio = _wav_audio_content(np.zeros(SAMPLE_RATE_HZ * 2, dtype=np.float32))

    with pytest.raises(ValueError, match="range is invalid"):
        create_rehearsal_audio_clip(audio, start_seconds=1, end_seconds=0.5)
    with pytest.raises(ValueError, match="recording ends"):
        create_rehearsal_audio_clip(audio, start_seconds=3, end_seconds=4)


def _wav_audio_content(samples: np.ndarray) -> AudioContent:
    output = BytesIO()
    pcm = (np.clip(samples, -1, 1) * np.iinfo(np.int16).max).astype("<i2")
    with wave.open(output, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE_HZ)
        wav_file.writeframes(pcm.tobytes())
    return AudioContent(
        data=output.getvalue(), file_name="source.wav", mime_type="audio/wav"
    )
