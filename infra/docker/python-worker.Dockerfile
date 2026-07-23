FROM python:3.12-slim

WORKDIR /app/services/python-worker

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-eng \
    tesseract-ocr-kor \
    libreoffice-writer \
    libreoffice-impress \
    fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

COPY services/python-worker/pyproject.toml services/python-worker/uv.lock ./
RUN uv sync --locked

COPY services/python-worker/config/ooxml-reference-fontconfig.conf \
  /etc/orbit-fontconfig/fonts.conf
COPY services/python-worker/config/ooxml-reference-font-aliases.conf \
  /etc/orbit-fontconfig/ooxml-reference-font-aliases.conf

COPY services/python-worker/ ./

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
