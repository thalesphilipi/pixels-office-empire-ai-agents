# Use node slim as base
FROM node:20-slim

# Install system dependencies for better-sqlite3 and sqlite3 CLI
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    sqlite3 \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Link data directory to root data for persistence
# Docker-compose will mount the actual host folder here
RUN mkdir -p /data

# Expose the API and Socket.IO port
EXPOSE 3000

# Start in dev mode with hot reload (tsx watch)
CMD ["npm", "run", "dev"]
