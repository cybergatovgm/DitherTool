FROM rust:1.99-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl file \
    libgtk-3-dev libwebkit2gtk-4.1-dev libssl-dev librsvg2-dev \
    libayatana-appindicator3-dev patchelf xdg-utils \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSLO https://nodejs.org/dist/v22.23.1/node-v22.23.1-linux-x64.tar.xz \
    && curl -fsSLO https://nodejs.org/dist/v22.23.1/SHASUMS256.txt \
    && grep ' node-v22.23.1-linux-x64.tar.xz$' SHASUMS256.txt | sha256sum -c - \
    && tar -xJf node-v22.23.1-linux-x64.tar.xz -C /usr/local --strip-components=1 \
    && rm node-v22.23.1-linux-x64.tar.xz SHASUMS256.txt

WORKDIR /app
ENV APPIMAGE_EXTRACT_AND_RUN=1
ENV NPM_CONFIG_CACHE=/app/src-tauri/target/container-npm
ENV XDG_CACHE_HOME=/app/src-tauri/target/container-cache
CMD ["sh", "-c", "npm ci && npx tauri build --ci --bundles deb,rpm,appimage -- --locked"]
