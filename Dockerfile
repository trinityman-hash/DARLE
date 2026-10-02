FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    NEEDLE_TELEMETRY=0 \
    NEEDLE_STRICT_VALIDATE=1
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install --include=dev

COPY . .
RUN pip3 install --break-system-packages cactus-needle==2.0.8 \
 && python3 -c "import needle" \
 && npm run build

ENV NEEDLE_BASE_URL=http://127.0.0.1:8765
EXPOSE 8080
CMD ["sh", "-c", "python3 server/needle_service.py & exec node dist/server.js"]
