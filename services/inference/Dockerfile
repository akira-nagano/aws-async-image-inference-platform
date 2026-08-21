ARG MODEL_PROFILE=stub

FROM scratch AS model-stub
COPY model-runtime/.gitkeep /opt/model/.gitkeep

FROM scratch AS model-catalog
COPY model-runtime /opt/model

FROM scratch AS model-real
COPY model-runtime /opt/model

FROM model-${MODEL_PROFILE} AS model-assets

FROM public.ecr.aws/lambda/python:3.12@sha256:c2edfd4c371e12d40962541427f732469c7823d2af91760e916ab336f416cf85

ARG MODEL_PROFILE=stub

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MODEL_PROFILE=${MODEL_PROFILE} \
    MODEL_PATH=/opt/model/model.bin

COPY requirements.txt ${LAMBDA_TASK_ROOT}/requirements.txt
RUN pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements.txt

RUN if [ "${MODEL_PROFILE}" = "catalog" ]; then \
      pip install --no-cache-dir \
        --index-url https://download.pytorch.org/whl/cpu \
        "torch==2.13.0+cpu" \
        "torchvision==0.28.0+cpu"; \
    fi

COPY requirements-catalog.txt ${LAMBDA_TASK_ROOT}/requirements-catalog.txt
RUN if [ "${MODEL_PROFILE}" = "catalog" ]; then \
      pip install --no-cache-dir -r ${LAMBDA_TASK_ROOT}/requirements-catalog.txt; \
    fi

COPY app ${LAMBDA_TASK_ROOT}/app
COPY --from=model-assets /opt/model /opt/model

RUN if [ "${MODEL_PROFILE}" = "catalog" ]; then \
      test -f /opt/model/catalog-index.json && \
      test -f /opt/model/dinov2-small/config.json && \
      test -f /opt/model/dinov2-small/preprocessor_config.json && \
      test -f /opt/model/dinov2-small/model.safetensors && \
      printf '%s  %s\n' \
        '1809f83e3bdb1609a501a610ad4a742f4fd8ae44d72ca4aa0df52d1f2ac8628d' \
        '/opt/model/dinov2-small/config.json' \
        '14e780d86fa1861f8751f868d7f45425b5feb55c38ca26f152ca5097ab30f828' \
        '/opt/model/dinov2-small/preprocessor_config.json' \
        'ae1e99fcefd534ed978cdeb8326f08030c96e28b7a81ffcbc98a857c84d14be1' \
        '/opt/model/dinov2-small/model.safetensors' | sha256sum --check --strict - && \
      python -c 'from app.catalog_index import load_catalog_index; load_catalog_index("/opt/model/catalog-index.json")'; \
    fi

CMD ["app.handler.handler"]
