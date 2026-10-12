FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CLOUD_MODE=1 \
    HOST=0.0.0.0 \
    PORT=10000

WORKDIR /app
COPY requirements-auth.txt ./
RUN pip install --no-cache-dir -r requirements-auth.txt \
    && useradd --system --uid 10001 --no-create-home appuser

# The explicit copy list and .dockerignore exclude local archives and orders.
COPY app.py auth.py ocp_catalog.py ./
COPY static ./static
USER appuser
EXPOSE 10000
CMD ["python", "app.py", "--cloud"]
