#!/bin/sh
set -eu

model="${OLLAMA_MODEL:-llama3.2}"
ollama serve &
server_pid=$!

stop_server() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
}
trap stop_server INT TERM

attempt=0
while ! ollama list >/dev/null 2>&1; do
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid"
    echo "Ollama server exited before becoming ready." >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 180 ]; then
    echo "Ollama did not become ready within 6 minutes." >&2
    exit 1
  fi
  sleep 2
done

if ! ollama show "$model" >/dev/null 2>&1; then
  echo "Pulling required Ollama model: $model"
  ollama pull "$model"
fi

if ! ollama show "$model" >/dev/null 2>&1; then
  echo "Required Ollama model is still unavailable: $model" >&2
  exit 1
fi

echo "Ollama is ready with model $model on ${OLLAMA_HOST:-0.0.0.0:11434}."
wait "$server_pid"
