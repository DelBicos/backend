FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL_PATH=/app/artifacts/intent_classifier.joblib

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./

# O artefato e as métricas são sempre derivados do corpus versionado.
RUN python -m app.train --data /app/data/intents.json --artifact-dir /app/artifacts
RUN python -m pytest -q

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
