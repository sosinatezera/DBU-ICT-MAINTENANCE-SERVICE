FROM ollama/ollama:latest

# Configure Ollama to listen on Render's private network and store models under
# the persistent disk mounted at /root/.ollama by render.yaml.
ENV OLLAMA_HOST=0.0.0.0:11434
ENV OLLAMA_MODELS=/root/.ollama/models

RUN mkdir -p /root/.ollama/models
EXPOSE 11434

COPY deploy/ollama/start-ollama.sh /usr/local/bin/start-ollama.sh
RUN chmod 0755 /usr/local/bin/start-ollama.sh

ENTRYPOINT ["/usr/local/bin/start-ollama.sh"]