FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-pip python3-venv build-essential \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY requirements-python.txt ./
RUN python3 -m pip install --break-system-packages --no-cache-dir -r requirements-python.txt

COPY . .

ENV NODE_ENV=production
ENV PYTHON_PATH=python3
ENV ANALYSIS_TIMEOUT_MS=90000

EXPOSE 3000

CMD ["npm", "start"]
