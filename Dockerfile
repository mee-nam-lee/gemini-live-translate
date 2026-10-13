FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY static ./static

EXPOSE 8080

# Single worker keeps in-memory RESUMABLE_SESSIONS consistent per instance.
# Cloud Run supports WebSockets natively; keep-alive timeout is managed by --timeout at deploy time.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --ws-ping-interval 20 --ws-ping-timeout 60"]
