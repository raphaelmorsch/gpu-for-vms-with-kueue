FROM registry.access.redhat.com/ubi9/python-311:latest

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER 0
WORKDIR /opt/app-root/src

COPY backend/requirements.txt /opt/app-root/src/requirements.txt
RUN pip install --no-cache-dir -r /opt/app-root/src/requirements.txt

COPY backend/*.py /opt/app-root/src/
COPY ui/dist /opt/app-root/src/static
RUN chown -R 1001:0 /opt/app-root/src

USER 1001
EXPOSE 8080

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8080"]
