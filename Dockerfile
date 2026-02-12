FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY . /app

EXPOSE 8000

ENV FDL_AUTO_SYNC_ON_START=1
ENV FDL_SYNC_BLOCKING=0

CMD ["sh", "-c", "python3 terminal_server.py --host 0.0.0.0 --port ${PORT:-8000}"]
