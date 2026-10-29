FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Run as an unprivileged user
RUN useradd --system --no-create-home --uid 10001 app

COPY --chown=app:app app ./app
COPY --chown=app:app static ./static

USER app

EXPOSE 8080

# Single worker keeps in-memory RESUMABLE_SESSIONS consistent per instance.
# Cloud Run supports WebSockets natively; keep-alive timeout is managed by --timeout at deploy time.
# `exec` makes uvicorn PID 1 so it receives SIGTERM and shuts down gracefully.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --workers 1 --ws-ping-interval 20 --ws-ping-timeout 60"]
