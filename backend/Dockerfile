FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev
RUN apk add --no-cache postgresql18-client

COPY . .
RUN mkdir -p uploads

EXPOSE 5000
CMD ["node", "server.js"]
