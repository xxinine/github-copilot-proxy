FROM node:22-slim
WORKDIR /app

# Workspace manifests first for better layer caching.
COPY package.json ./
COPY shared/package.json ./shared/
COPY control-plane/package.json ./control-plane/
COPY gateway/package.json ./gateway/

RUN npm install

# Source.
COPY tsconfig.base.json ./
COPY shared ./shared
COPY control-plane ./control-plane

ENV NODE_ENV=production
EXPOSE 8080
CMD ["npm", "-w", "control-plane", "run", "start"]
