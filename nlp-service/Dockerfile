FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL_PATH=/app/artifacts/intent_classifier.joblib \
    SEMANTIC_MODEL_NAME=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2 \
    HF_HOME=/app/.cache/huggingface

COPY requirements.txt ./
# sentence-transformers depende de PyTorch. A distribuição padrão atual pode
# baixar bibliotecas CUDA de vários GB, apesar de o container não usar GPU.
# Instalar a wheel CPU antes satisfaz essa dependência e mantém a imagem viável
# em máquinas de desenvolvimento e no MVP.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch --no-deps \
    && pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir filelock fsspec jinja2 networkx sympy

COPY . ./

# Mantém o modelo de embeddings dentro da imagem, evitando um download na
# primeira consulta em produção.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')"

# O artefato e as métricas são sempre derivados do corpus versionado.
RUN python -m app.train --data /app/data/intents.json --artifact-dir /app/artifacts
RUN python -m pytest -q

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
