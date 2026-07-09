FROM node:24-alpine
WORKDIR /app
COPY ./frontend .
RUN npm install
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
