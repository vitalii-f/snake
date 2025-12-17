FROM oven/bun:latest

WORKDIR /app

# Copy package files
COPY package.json .
COPY bun.lock .

# Copy prisma schema
COPY prisma ./prisma

# Install dependencies
RUN bun install

# Generate Prisma client
RUN bunx prisma generate

# Copy server code
COPY server ./server

# Copy client static files
COPY public ./public

# Expose port
EXPOSE 3021

# Start server
CMD ["bun", "run", "server/index.ts"]
