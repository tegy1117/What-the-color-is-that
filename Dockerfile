FROM node:24-alpine AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
EXPOSE 3000
CMD ["node", "apps/server/dist/index.js"]

