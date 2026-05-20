FROM node:20-slim

WORKDIR /app

# Copy pre-built standalone output
COPY .next/standalone ./
COPY .next/static ./.next/static
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3001/ || exit 1

CMD ["node", "server.js"]
