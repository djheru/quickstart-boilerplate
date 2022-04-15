import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as certificatemanager from 'aws-cdk-lib/aws-certificatemanager';
import * as elasticloadbalancingv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import { Environment } from './quickstart-stack';

export interface AutoScalingConfig {
  maxCapacity?: number;
  minCapacity?: number;
  cpuTargetUtilizationPercent?: number;
  ramTargetUtilizationPercent?: number;
}

export interface EcsServiceProps {
  environmentName: Environment;
  hostedZoneDomainName: string;
  hostedZone: route53.IHostedZone;
  securityGroup: ec2.SecurityGroup;
  serviceName: string;
  taskEnvironment: Record<string, string>;
  taskSecrets: Record<string, ecs.Secret>;
  vpc: ec2.Vpc;
  autoscalingConfig?: AutoScalingConfig;
}

export class EcsService extends Construct {
  public id: string;
  public certificate: certificatemanager.Certificate;
  public domainName: string;
  public serviceName: string;
  public environmentName: Environment;
  public hostedZoneDomainName: string;
  public securityGroup: ec2.SecurityGroup;
  public taskEnvironment: Record<string, string>;
  public taskSecrets: Record<string, ecs.Secret>;
  public vpc: ec2.Vpc;
  public autoscalingConfig: AutoScalingConfig;

  public hostedZone: route53.IHostedZone;
  public clusterAdminRole: iam.Role;
  public taskRole: iam.Role;
  public cluster: ecs.Cluster;
  public ecsExecutionRolePolicy: iam.PolicyStatement;
  public service: ecs_patterns.ApplicationLoadBalancedFargateService;
  public ecrRepository: ecr.Repository;

  constructor(scope: Construct, id: string, props: EcsServiceProps) {
    super(scope, id);

    const {
      environmentName,
      hostedZoneDomainName,
      hostedZone,
      securityGroup,
      serviceName,
      taskEnvironment,
      taskSecrets,
      vpc,
      autoscalingConfig,
    } = props;

    this.id = id;
    this.environmentName = environmentName;
    this.hostedZone = hostedZone;
    this.hostedZoneDomainName = hostedZoneDomainName;
    this.serviceName = serviceName;

    this.domainName = `${this.serviceName}.${this.environmentName}.${this.hostedZoneDomainName}`;

    this.vpc = vpc;
    this.securityGroup = securityGroup;

    this.taskEnvironment = taskEnvironment;
    this.taskSecrets = taskSecrets;
    this.autoscalingConfig = autoscalingConfig || {};

    this.buildResources();
  }

  buildResources() {
    this.buildEcrRepository();
    this.buildRoles();
    this.createCertificate();
    this.buildCluster();
    this.buildExecutionRolePolicyStatement();
    this.buildEcsService();
    this.configureServiceAutoscaling();
  }

  buildEcrRepository() {
    const ecrRepositoryId = `${this.id}-ecr-repository`;
    this.ecrRepository = new ecr.Repository(this, ecrRepositoryId, {
      imageScanOnPush: true,
      repositoryName: `quickstart-${this.environmentName}/${this.serviceName}`,
      lifecycleRules: [
        {
          description: 'Remove old images',
          maxImageCount: 50,
        },
      ],
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const ecrRepositoryOutputId = `ecr-repo-uri`;
    new CfnOutput(this, ecrRepositoryOutputId, {
      value: this.ecrRepository.repositoryUri,
      exportName: `${this.id}-${ecrRepositoryOutputId}`,
    });
  }

  buildRoles() {
    const clusterAdminRoleId = `${this.id}-cluster-admin-role`;
    this.clusterAdminRole = new iam.Role(this, clusterAdminRoleId, {
      assumedBy: new iam.AccountRootPrincipal(),
    });

    const taskRoleId = `${this.id}-task-role`;
    this.taskRole = new iam.Role(this, taskRoleId, {
      roleName: taskRoleId,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AmazonECSTaskExecutionRolePolicy'
        ),
      ],
    });
  }

  private createCertificate() {
    const certificateId = `${this.id}-certificate`;
    this.certificate = new certificatemanager.Certificate(this, certificateId, {
      domainName: this.domainName,
      validation: certificatemanager.CertificateValidation.fromDns(this.hostedZone),
    });
  }

  buildCluster() {
    const clusterId = `${this.id}-cluster`;
    this.cluster = new ecs.Cluster(this, clusterId, {
      vpc: this.vpc,
      clusterName: clusterId,
    });
  }

  buildExecutionRolePolicyStatement() {
    this.ecsExecutionRolePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        'ecr:GetAuthorizationToken',
        'ecr:BatchCheckLayerAvailability',
        'ecr:GetDownloadUrlForLayer',
        'ecr:BatchGetImage',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
        'secretsmanager:GetSecret',
        'secretsmanager:GetSecretValue',
      ],
    });
  }

  buildEcsService() {
    const serviceId = `${this.id}-ecs`;
    this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      serviceId,
      {
        assignPublicIp: false,
        cluster: this.cluster,
        cpu: 1024,
        memoryLimitMiB: 2048,
        domainName: this.domainName,
        domainZone: this.hostedZone,
        certificate: this.certificate,
        circuitBreaker: { rollback: true },
        loadBalancerName: `${this.id}-lb`,
        platformVersion: ecs.FargatePlatformVersion.VERSION1_4,
        protocol: elasticloadbalancingv2.ApplicationProtocol.HTTPS,
        redirectHTTP: true,
        securityGroups: [this.securityGroup],
        serviceName: serviceId,
        taskImageOptions: {
          containerName: this.id,
          containerPort: this.taskEnvironment.PORT
            ? parseInt(this.taskEnvironment.PORT)
            : 4000,
          image: ecs.ContainerImage.fromEcrRepository(
            // Default (environment UNaware repo)
            // Subsequent builds go to the environment aware repo
            // Run the command "yarn docker-init" to initialize this one BEFORE the initial deploy
            ecr.Repository.fromRepositoryName(
              this,
              `${this.id}-ecr-base-repository`,
              `quickstart/${this.serviceName}`
            )
          ),
          taskRole: this.taskRole,
          environment: this.taskEnvironment,
          secrets: this.taskSecrets,
        },
      }
    );

    this.service.taskDefinition.addToExecutionRolePolicy(this.ecsExecutionRolePolicy);
    this.taskRole.addToPolicy(this.ecsExecutionRolePolicy);
  }

  configureServiceAutoscaling() {
    const {
      maxCapacity = 4,
      minCapacity = 1,
      cpuTargetUtilizationPercent = 50,
      ramTargetUtilizationPercent = 50,
    } = this.autoscalingConfig;

    const scalableTarget = this.service.service.autoScaleTaskCount({
      maxCapacity,
      minCapacity,
    });

    scalableTarget.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: cpuTargetUtilizationPercent,
    });

    scalableTarget.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: ramTargetUtilizationPercent,
    });
  }
}
