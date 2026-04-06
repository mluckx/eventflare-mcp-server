FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
RUN npx tsc
ENV TRANSPORT=http
ENV PORT=3001
EXPOSE 3001
CMD ["node", "dist/index.js"]
