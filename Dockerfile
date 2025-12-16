FROM oven/bun:latest

WORKDIR /app

# Copy server code
COPY server ./server

# Copy client static files
COPY index.html .
COPY style.css .
COPY script.js .

# Expose port
EXPOSE 3020

# Start server
CMD ["bun", "run", "server/index.ts"]
