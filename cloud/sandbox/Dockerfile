# SuperRoo Cloud — Sandbox Dockerfile
# Base image with Node.js 20 and tooling for job execution.

FROM node:20

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Set working directory
WORKDIR /workspace

# Default command (overridden by docker run)
CMD ["bash"]
