FROM node:24-bookworm-slim

ARG DWS_VERSION=v1.0.62
ARG DWS_SHA256=6198a86570ea52f24d88a58dfe65514540793c4dd64410cb133a8ff7b3b008a8
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy

COPY vendor/dws-linux-amd64.tar.gz /tmp/dws.tar.gz
RUN echo "${DWS_SHA256}  /tmp/dws.tar.gz" | sha256sum -c - \
 && mkdir -p /tmp/dws-extract \
 && tar -xzf /tmp/dws.tar.gz -C /tmp/dws-extract \
 && bin="$(find /tmp/dws-extract -type f -name dws | head -n 1)" \
 && test -n "$bin" \
 && install -m 0755 "$bin" /usr/local/bin/dws \
 && rm -rf /tmp/dws.tar.gz /tmp/dws-extract \
 && printf '%s' "${HTTP_PROXY:-}${HTTPS_PROXY:-}${http_proxy:-}${https_proxy:-}" >/dev/null \
 && groupadd --system --gid 10077 dws \
 && useradd --system --uid 10077 --gid 10077 --home-dir /var/lib/dws/home --create-home --shell /usr/sbin/nologin dws \
 && mkdir -p /var/lib/dws/config /var/lib/dws/keychain /var/lib/dws/home \
 && chown -R 10077:10077 /var/lib/dws \
 && chmod 0700 /var/lib/dws/config /var/lib/dws/keychain /var/lib/dws/home

WORKDIR /app
COPY package.json /app/package.json
COPY src/ /tmp/dws-src/
RUN mkdir -p /app/src \
 && cp /tmp/dws-src/*.ts /app/src/ \
 && rm -f /app/src/*.test.ts \
 && rm -rf /tmp/dws-src

ENV DWS_CONFIG_DIR=/var/lib/dws/config \
    DWS_KEYCHAIN_DIR=/var/lib/dws/keychain \
    HOME=/var/lib/dws/home \
    DWS_BIN=/usr/local/bin/dws \
    PORT=8080 \
    NO_COLOR=1 \
    TZ=Asia/Shanghai \
    NODE_ENV=production

USER 10077
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "src/server.ts"]
