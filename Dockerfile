FROM --platform=linux/amd64 ghcr.io/openclaw/openclaw:latest

USER root

# Install FUSE libraries and tigrisfs for R2 persistent storage
RUN if command -v apt-get >/dev/null 2>&1; then \
      apt-get update -qq && apt-get install -y --no-install-recommends fuse ca-certificates curl && rm -rf /var/lib/apt/lists/*; \
    elif command -v apk >/dev/null 2>&1; then \
      apk add --no-cache fuse ca-certificates curl; \
    fi && \
    VERSION=$(curl -s https://api.github.com/repos/tigrisdata/tigrisfs/releases/latest | grep -o '"tag_name": "[^"]*' | cut -d'"' -f4) && \
    curl -fsSL "https://github.com/tigrisdata/tigrisfs/releases/download/${VERSION}/tigrisfs_${VERSION#v}_linux_amd64.tar.gz" -o /tmp/tigrisfs.tar.gz && \
    tar -xzf /tmp/tigrisfs.tar.gz -C /usr/local/bin/ && \
    rm /tmp/tigrisfs.tar.gz && \
    chmod +x /usr/local/bin/tigrisfs

COPY startup.sh /startup.sh
RUN chmod +x /startup.sh
EXPOSE 18789
CMD ["/startup.sh"]
