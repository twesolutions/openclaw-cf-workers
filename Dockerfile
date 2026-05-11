FROM --platform=linux/amd64 ghcr.io/openclaw/openclaw:latest
RUN true
EXPOSE 18789
CMD ["openclaw", "gateway", "--port", "18789", "--bind", "lan", "--allow-unconfigured"]
