import { Construct } from 'constructs';
import { SecretValue, Stack } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';

import { pascalCase } from 'pascal-case';
import { EcsService } from './ecs-service';
import {
  apiProjectConfig,
  infrastructureProjectConfig,
  migrationProjectConfig,
} from './project-buildspec';
import { Environment } from './quickstart-stack';

export interface RecipesPipelineProps {
  cluster: ecs.ICluster;
  databaseCredentialsSecretArn: string;
  environmentName: Environment;
  repository: ecr.IRepository;
  securityGroup: ec2.ISecurityGroup;
  service: EcsService;
  vpc: ec2.IVpc;
}

export class QuickstartPipeline extends Construct {
  static GITHUB_TOKEN_SECRET_NAME = 'github-token';
  static REPO_NAME = 'quickstart-boilerplate';
  static REPO_OWNER = 'djheru';
  static environmentBranchMapping: Record<string, string> = {
    dev: 'dev',
    test: 'test',
    prod: 'main',
  };

  public sourceAction: codepipeline_actions.GitHubSourceAction;

  public sourceArtifact = new codepipeline.Artifact();
  public buildArtifact = new codepipeline.Artifact();

  private infrastructureRole: iam.Role;
  private infrastructureAction: codepipeline_actions.CodeBuildAction;
  private apiAction: codepipeline_actions.CodeBuildAction;
  private migrationAction: codepipeline_actions.CodeBuildAction;
  private deployApiAction: codepipeline_actions.EcsDeployAction;

  constructor(
    scope: Construct,
    public readonly id: string,
    private readonly props: RecipesPipelineProps
  ) {
    super(scope, id);

    this.id = id;

    this.buildResources();
  }

  buildResources() {
    this.buildSourceAction();
    this.buildInfrastructureRole();
    this.buildInfrastructureAction();
    this.buildApiAction();
    this.buildMigrationAction();
    this.buildDeployApiAction();
    this.buildPipeline();
  }

  buildSourceAction() {
    const branch =
      QuickstartPipeline.environmentBranchMapping[this.props.environmentName] ||
      this.props.environmentName;
    const oauthToken = SecretValue.secretsManager(
      QuickstartPipeline.GITHUB_TOKEN_SECRET_NAME
    );
    const sourceActionId = `source-action`;
    this.sourceAction = new codepipeline_actions.GitHubSourceAction({
      actionName: pascalCase(sourceActionId),
      owner: QuickstartPipeline.REPO_OWNER,
      repo: QuickstartPipeline.REPO_NAME,
      branch,
      oauthToken,
      output: this.sourceArtifact,
    });
  }

  buildInfrastructureRole() {
    const infrastructureRoleId = `${this.id}-infrastructure-role`;
    this.infrastructureRole = new iam.Role(this, infrastructureRoleId, {
      assumedBy: new iam.ServicePrincipal('codebuild.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
      roleName: infrastructureRoleId,
    });
  }

  buildInfrastructureAction() {
    const projectConfig = infrastructureProjectConfig({
      id: this.id,
      environmentName: this.props.environmentName,
      stackName: Stack.of(this).stackName,
      role: this.infrastructureRole,
    });
    const infrastructureProjectId = `${this.id}-infrastructure-project`;
    const infrastructureProject = new codebuild.PipelineProject(
      this,
      infrastructureProjectId,
      projectConfig
    );

    const infrastructureActionId = `infrastructure-action`;
    this.infrastructureAction = new codepipeline_actions.CodeBuildAction({
      actionName: pascalCase(infrastructureActionId),
      input: this.sourceArtifact,
      project: infrastructureProject,
    });
  }

  buildApiAction() {
    const projectConfig = apiProjectConfig({
      id: this.id,
      environmentName: this.props.environmentName,
      serviceName: this.props.service.id,
      clusterName: this.props.cluster.clusterName,
      repositoryName: this.props.repository.repositoryName,
      repositoryUri: this.props.repository.repositoryUri,
      sourcePath: './api',
    });
    const buildApiProjectId = `${this.id}-build-api-project`;
    const buildApiProject = new codebuild.PipelineProject(
      this,
      buildApiProjectId,
      projectConfig
    );

    this.props.repository.grantPullPush(<iam.Role>buildApiProject.role);
    buildApiProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'ecs:DescribeCluster',
          'ecr:GetAuthorizationToken',
          'ecr:BatchCheckLayerAvailability',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
        ],
        resources: [this.props.cluster.clusterArn],
      })
    );

    const apiActionId = `build-api-action`;
    this.apiAction = new codepipeline_actions.CodeBuildAction({
      actionName: pascalCase(apiActionId),
      input: this.sourceArtifact,
      project: buildApiProject,
      outputs: [this.buildArtifact],
    });
  }

  buildMigrationAction() {
    const projectConfig = migrationProjectConfig({
      databaseCredentialsSecretArn: this.props.databaseCredentialsSecretArn,
      environmentName: this.props.environmentName,
      id: this.id,
      securityGroup: this.props.securityGroup,
      sourcePath: './api',
      vpc: this.props.vpc,
    });
    const migrationProjectId = `${this.id}-migration-project`;
    const migrationProject = new codebuild.PipelineProject(
      this,
      migrationProjectId,
      projectConfig
    );

    const migrationActionId = `run-migrations-action`;
    this.migrationAction = new codepipeline_actions.CodeBuildAction({
      actionName: pascalCase(migrationActionId),
      input: this.sourceArtifact,
      project: migrationProject,
    });
  }

  buildDeployApiAction() {
    const deployApiActionId = `deploy-api-action`;
    this.deployApiAction = new codepipeline_actions.EcsDeployAction({
      actionName: pascalCase(deployApiActionId),
      service: this.props.service.service.service,
      imageFile: new codepipeline.ArtifactPath(
        this.buildArtifact,
        'imagedefinitions.json'
      ),
    });
  }

  buildPipeline() {
    const pipelineId = `${this.id}-pipeline`;
    new codepipeline.Pipeline(this, pipelineId, {
      pipelineName: this.id,
      restartExecutionOnUpdate: true,
      stages: [
        {
          stageName: 'CheckoutSource',
          actions: [this.sourceAction],
        },
        {
          stageName: 'DeployInfrastructure',
          actions: [this.infrastructureAction],
        },
        {
          stageName: 'BuildAPI',
          actions: [this.apiAction],
        },
        {
          stageName: 'DeployAPI',
          actions: [this.deployApiAction, this.migrationAction],
        },
      ],
    });
  }
}
