# SuperRoo Cloud — Sandbox Dockerfile
# Base image with Node.js 20 and tooling for job execution.
# Designed for crash resilience: non-root user, resource limits, health checks.

FROM node:20

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    bash \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# Create non-root user for sandbox isolation
RUN groupadd -r sandbox && useradd -r -g sandbox -d /workspace -s /bin/bash sandbox

# Set working directory
WORKDIR /workspace

# Ensure workspace is owned by sandbox user
RUN chown -R sandbox:sandbox /workspace

# Health check — verifies the container is alive and responsive
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD pgrep -x bash > /dev/null || exit 1

# Use tini as init to handle zombie reaping and signal forwarding
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command (overridden by docker run)
CMD ["bash"]

# Switch to non-root user by default
USER sandbox
