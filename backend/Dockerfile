# Express API. Build context is ./backend (see docker-compose.yml).
FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependencies first so source edits don't bust the install layer.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# Copy source explicitly (the repo does not track a .dockerignore, so `COPY . .`
# would drag in a host node_modules). Add new top-level folders here.
COPY app.js config.js ./
COPY bin ./bin
COPY api ./api
COPY db ./db
COPY security ./security
COPY repositories ./repositories
COPY services ./services
COPY routes ./routes
COPY views ./views
COPY public ./public

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./bin/www"]
