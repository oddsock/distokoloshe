FROM python:3.12-slim

# Install ffmpeg, Node.js (for npm), and deps for Playwright/Chromium
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    wget \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright Chromium
RUN playwright install chromium --with-deps

# Install livekit-client for the browser page
COPY browser/package.json browser/
RUN cd browser && npm install --omit=dev

# Copy application code
COPY . .

EXPOSE 3001

CMD ["python", "main.py"]
