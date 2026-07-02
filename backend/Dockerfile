FROM node:24-alpine AS build
WORKDIR /server
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build


FROM node:24-alpine
WORKDIR /server
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /server/src ./src
CMD ["node", "src/server.js"]