FROM public.ecr.aws/bitnami/node:latest as development

### Build for development
ENV NODE_ENV=development
WORKDIR /usr/src/app

# Install development packages so we can build and test
COPY package.json ormconfig.js tsconfig.build.json tsconfig.json ./
RUN yarn install --silent

# Copy the files from the local environment, node_modules excluded in .dockerignore
COPY . .

# Transpile TS to JS
RUN yarn build

# -----------------------------------------------------------------------

### Build for test
FROM public.ecr.aws/bitnami/node:latest as test
ARG NODE_ENV=test
ENV NODE_ENV=${NODE_ENV}
WORKDIR /usr/src/app

# Copy the installed and built files from the development stage
COPY --from=development /usr/src/app ./

# Tests must pass for the docker build to complete successfully
RUN yarn test -- --passWithNoTests

# -----------------------------------------------------------------------

### Build for production
FROM public.ecr.aws/bitnami/node:latest as production
ARG NODE_ENV=production
ENV NODE_ENV=${NODE_ENV}

WORKDIR /usr/src/app
COPY package.json ./
RUN yarn install --production --silent

# Copy the transpiled build files from the development stage
COPY --from=development /usr/src/app/dist ./dist
CMD ["node", "dist/main"]
