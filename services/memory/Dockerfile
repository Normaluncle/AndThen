FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY server.py .
RUN useradd --uid 10001 --create-home memory && mkdir /data && chown memory /data
USER memory
ENV MEMORY_DATA_DIR=/data
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8090", "--no-access-log"]
