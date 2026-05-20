# SuperRoo Cloud — Go Sandbox Image
# Multi-language sandbox with Go 1.22 for compiled code workflows.
#
# Build:
#   docker build -t superroo-sandbox:go -f Dockerfile.go .
#
# Usage:
#   docker run --rm superroo-sandbox:go go version

FROM golang:1.22-bookworm

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
	git \
	curl \
	bash \
	tini \
	ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Create sandbox user
RUN useradd -m -s /bin/bash sandbox && \
	mkdir -p /workspace && \
	chown -R sandbox:sandbox /workspace

WORKDIR /workspace
USER sandbox

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
	CMD go version

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["go", "version"]
