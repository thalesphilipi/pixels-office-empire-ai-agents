# Use node slim as base
FROM node:20-slim

WORKDIR /app

# Copy dependency files
COPY package.json package-lock.json* ./

# Install dependencies (mostly devDeps for Vite)
RUN npm install

# Copy source code
COPY . .

# Expose Vite's default dev port
EXPOSE 5173

# Run Vite with --host to allow external access from the container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
