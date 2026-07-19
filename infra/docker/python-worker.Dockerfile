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

COPY packages/font-assets/assets/desktop/ /usr/local/share/fonts/orbit/
COPY packages/font-assets/assets/manifest.json /opt/orbit-fonts/manifest.json
COPY packages/font-assets/fontconfig/99-orbit-fonts.conf /etc/fonts/conf.d/99-orbit-fonts.conf
COPY packages/font-assets/scripts/check_worker_fonts.py /opt/orbit-fonts/check_worker_fonts.py
RUN fc-cache -f \
  && python /opt/orbit-fonts/check_worker_fonts.py \
    --manifest /opt/orbit-fonts/manifest.json \
    --font-root /usr/local/share/fonts/orbit \
    --check-fontconfig

COPY services/python-worker/ ./

RUN uv run python /opt/orbit-fonts/check_worker_fonts.py \
  --manifest /opt/orbit-fonts/manifest.json \
  --font-root /usr/local/share/fonts/orbit \
  --libreoffice-smoke

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
