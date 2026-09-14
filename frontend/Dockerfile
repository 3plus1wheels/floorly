FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY public ./public
COPY src ./src
COPY postcss.config.js tailwind.config.js ./
ARG REACT_APP_API_BASE_URL=
ARG REACT_APP_FLOORLY_EXTENSION_ID=
ARG REACT_APP_FLOORLY_EXTENSION_STORE_URL=
ENV REACT_APP_API_BASE_URL=$REACT_APP_API_BASE_URL \
    REACT_APP_FLOORLY_EXTENSION_ID=$REACT_APP_FLOORLY_EXTENSION_ID \
    REACT_APP_FLOORLY_EXTENSION_STORE_URL=$REACT_APP_FLOORLY_EXTENSION_STORE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/build /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
