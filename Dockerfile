FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json .
COPY bun.lock .

# Install dependencies
RUN bun install

# Copy server code
COPY server ./server

# Copy client static files
COPY public ./public

# Expose port
EXPOSE 3020

# Start server
CMD ["bun", "run", "server/index.ts"]
