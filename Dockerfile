FROM node:20-alpine AS build
WORKDIR /app

ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Copy dependency manifests first for better layer caching
COPY package*.json ./
RUN npm ci

# Copy source files in optimal order (rarely changed files first)
COPY vite.config.js eslint.config.js index.html ./
COPY public ./public
COPY src ./src

# Build the application and clean npm cache
RUN npm run build && npm cache clean --force

FROM nginx:1.27-alpine

# Add health check for container orchestration
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost/index.html || exit 1

# Copy nginx config and build artifacts
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
