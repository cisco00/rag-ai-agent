#!/bin/bash
set -e

# Activate virtual environment
if [ -d ".venv" ]; then
    source .venv/bin/activate
else
    echo "Warning: .venv not found. Running with system python."
fi

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Run migrations
echo "Running database migrations..."
python -m alembic upgrade head

# Start server
echo "Starting server..."
# Use exec to replace shell with python process for proper signal handling
exec python src/api.py
