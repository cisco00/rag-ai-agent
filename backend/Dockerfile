# Backend Dockerfile (build context = backend/ directory)
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    default-libmysqlclient-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir --timeout=300 --retries=5 -r requirements.txt

# Copy the rest of the backend code
COPY . .

# Security: run as non-root user
RUN useradd --create-home --shell /bin/bash appuser && \
    chown -R appuser:appuser /app
USER appuser

# Expose port
EXPOSE 8000

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV PORT=8000
# Production defaults — these tell the app it is running on the web platform
# and activate the built-in Gemini key so the LLM works out-of-the-box.
# Override any of these in the Railway dashboard to use a different provider.
ENV ENVIRONMENT=production
ENV LLM_PROVIDER=google
ENV LLM_MODEL_NAME=gemini-1.5-pro

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Run migrations (non-fatal) then start the application.
# Using || instead of && so a migration failure (e.g. DB unreachable at boot)
# never prevents the API from starting — the app can still serve health checks
# and non-DB endpoints while the database becomes available.
CMD ["sh", "-c", "alembic upgrade head || echo '[WARN] DB migrations failed – the server will still start; check DATABASE_URL and DB connectivity'; uvicorn api:app --host 0.0.0.0 --port ${PORT:-8000}"]
