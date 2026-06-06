FROM node:22-slim
WORKDIR /app

COPY package.json ./
COPY shared/package.json ./shared/
COPY control-plane/package.json ./control-plane/
COPY gateway/package.json ./gateway/

RUN npm install

COPY tsconfig.base.json ./
COPY shared ./shared
COPY gateway ./gateway

ENV NODE_ENV=production
EXPOSE 4000
CMD ["npm", "-w", "gateway", "run", "start"]
