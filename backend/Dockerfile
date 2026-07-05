FROM node:22-alpine

WORKDIR /app

COPY ./backend/package*.json ./backend/tsconfig.json ./
RUN npm install

COPY ./backend/src ./src

EXPOSE 3000

CMD ["npm", "run", "dev"]
