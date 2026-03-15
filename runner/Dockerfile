FROM ubuntu:24.04

# Avoid tzdata interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Update and install dependencies
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    sudo \
    git \
    nano \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm npm@latest

# Create working directory
WORKDIR /app

# Copy the runner service
COPY package*.json ./
RUN npm install

COPY . .

# Set up the isolated workspace directory
RUN mkdir -p /workspace

# Expose port for Orchestrator to communicate with Runner
EXPOSE 4000

CMD ["node", "index.js"]
