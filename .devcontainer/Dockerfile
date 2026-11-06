
FROM oven/bun:1

RUN apt-get update && apt-get install -y \
    procps \
    git \
    curl \
    wget \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

USER bun

CMD ["sleep", "infinity"]
