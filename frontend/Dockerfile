# Frontend Dockerfile
# Stage 1: Build
FROM node:18-alpine AS build

WORKDIR /app

# Copy package files
COPY package.json .
COPY package-lock.json* .

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the app
ARG VITE_API_BASE_URL
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# Stage 2: Serve
FROM nginx:stable-alpine

# Copy build output to nginx
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config if you have one, or use default
# COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
