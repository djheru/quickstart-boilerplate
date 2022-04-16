import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { pascalCase } from 'pascal-case';
import { Environment } from './quickstart-stack';

export const CDK_VERSION = '2.20.0';

export interface InfrastructureProjectConfigParams {
  id: string;
  environmentName: Environment;
  stackName: string;
  role: iam.Role;
}
export const infrastructureProjectConfig = ({
  id,
  environmentName,
  stackName,
  role,
}: InfrastructureProjectConfigParams) => ({
  projectName: pascalCase(`${id}-infrastructure-build`),
  description: 'CodeBuild project to perform CDK deployments on the Application DB stack',
  environment: {
    buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
    privileged: true,
  },
  environmentVariables: {
    CDK_ENV: {
      value: environmentName,
    },
    CDK_DEBUG: {
      value: 'true',
    },
  },
  buildSpec: codebuild.BuildSpec.fromObject({
    version: '0.2',
    phases: {
      install: {
        commands: [
          'echo Build started at `date`',
          `echo Beginning infrastructure and static site build operations for "${id}"`,
          'yarn config set unsafe-perm true',
          'yarn install --silent',
          'yarn --cwd ./web install',
          `yarn global add typescript aws-cdk@${CDK_VERSION} parcel-bundler --silent`,
        ],
      },
      build: { commands: ['yarn --cwd ./web build', 'cdk synth'] },
      post_build: {
        commands: [
          'echo Updating the Application DB CDK infrastructure stack...',
          `cdk deploy ${stackName} --require-approval never --no-color`,
          'echo Build completed at `date`',
        ],
      },
    },
  }),
  role,
});

export interface ApiProjectConfigParams {
  id: string;
  clusterName: string;
  environmentName: Environment;
  repositoryName: string;
  repositoryUri: string;
  serviceName: string;
  sourcePath: string;
}

export const apiProjectConfig = ({
  clusterName,
  id,
  repositoryName,
  repositoryUri,
  serviceName,
  sourcePath,
}: ApiProjectConfigParams) => ({
  projectName: pascalCase(`${id}-api-build`),
  environment: {
    buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
    privileged: true,
  },
  environmentVariables: {
    CLUSTER_NAME: {
      value: clusterName,
    },
    ECR_REPO_URI: {
      value: repositoryUri,
    },
  },
  buildSpec: codebuild.BuildSpec.fromObject({
    version: '0.2',
    phases: {
      pre_build: {
        commands: [
          'echo Build started at `date`',
          `cd ${sourcePath}`,
          'yarn global add @nestjs/cli typeorm --silent',
          'yarn install --silent',
          'export TAG=$(echo $CODEBUILD_RESOLVED_SOURCE_VERSION | cut -c 1-9)',
          `echo Beginning build operations for "${repositoryName}"`,
          'echo Logging in to AWS ECR...',
          `aws ecr get-login-password \
            | docker login \
            -u AWS --password-stdin \
            "https://$(aws sts get-caller-identity --query 'Account' --output text).dkr.ecr.us-east-1.amazonaws.com"`,
        ],
      },
      build: {
        commands: [
          'yarn build',
          'echo Building the Docker image...',
          'echo DOCKER TAG: $TAG',
          'echo Tagging the Docker image...',
          'docker build -t $ECR_REPO_URI:$TAG . --progress=plain',
          'docker tag $ECR_REPO_URI:$TAG $ECR_REPO_URI:latest',
        ],
      },
      post_build: {
        commands: [
          'echo Pushing the Docker image...',
          'docker push $ECR_REPO_URI:$TAG',
          'docker push $ECR_REPO_URI:latest',
          `echo "Saving new imagedefinitions.json as build artifact..."`,
          `printf '[{"name": "${serviceName}", "imageUri": "%s"}]' $ECR_REPO_URI:$TAG > imagedefinitions.json`,
          'cat imagedefinitions.json',
          'echo Build completed on `date`',
        ],
      },
    },
    artifacts: {
      files: ['imagedefinitions.json'],
      'base-directory': sourcePath,
      'discard-paths': true,
    },
  }),
});

export interface MigrationProjectConfigProps {
  id: string;
  environmentName: Environment;
  databaseCredentialsSecretArn: string;
  securityGroup: ec2.ISecurityGroup;
  sourcePath: string;
  vpc: ec2.IVpc;
}

export const migrationProjectConfig = ({
  databaseCredentialsSecretArn,
  environmentName,
  id,
  securityGroup,
  sourcePath,
  vpc,
}: MigrationProjectConfigProps) => ({
  projectName: pascalCase(`${id}-migration-build`),
  checkSecretsInPlainTextEnvVariables: true,
  concurrentBuildLimit: 1,
  description: 'CodeBuild project to perform DB migrations on the Application DB',
  environment: {
    buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
  },
  environmentVariables: {
    CDK_ENV: {
      value: environmentName,
    },
    PGUSER: {
      value: `${databaseCredentialsSecretArn}:username`,
      type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
    },
    PGHOST: {
      value: `${databaseCredentialsSecretArn}:host`,
      type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
    },
    PGPORT: {
      value: `${databaseCredentialsSecretArn}:port`,
      type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
    },
    PGDATABASE: {
      value: `${databaseCredentialsSecretArn}:dbname`,
      type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
    },
    PGPASSWORD: {
      value: `${databaseCredentialsSecretArn}:password`,
      type: codebuild.BuildEnvironmentVariableType.SECRETS_MANAGER,
    },
  },
  securityGroups: [securityGroup],
  vpc: vpc,
  buildSpec: codebuild.BuildSpec.fromObject({
    version: '0.2',
    phases: {
      install: {
        commands: [
          'echo Build started at `date`',
          `cd ${sourcePath}`,
          'yarn install --silent',
          'yarn global add typeorm typescript --silent',
        ],
      },
      build: {
        commands: ['yarn build'],
      },
      post_build: {
        commands: ['yarn migrate:run', 'echo Build completed at `date`'],
      },
    },
  }),
});
