import { CfnOutput, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { snakeCase } from 'change-case';
import { Construct } from 'constructs';
import { EcsService } from './ecs-service';
import { QuickstartPipeline } from './quickstart-pipeline';
import { StaticSite } from './static-site';

export type Environment = 'dev' | 'prod' | 'test' | string;
export interface QuickstartStackProps extends StackProps {
  environmentName: Environment;
  serviceName: string;
  siteName: string;
  hostedZoneDomainName: string;
  databaseUsername?: string;
  defaultDatabaseName?: string;
  deletionProtection?: boolean;
  instanceType?: ec2.InstanceType;
  maxAzs?: number;
  removalPolicy?: RemovalPolicy;
}

export class QuickstartStack extends Stack {
  public id: string;
  public environmentName: Environment;
  public serviceName: string;
  public siteName: string;
  public hostedZoneDomainName: string;

  // Route53 DNS
  public hostedZone: route53.IHostedZone;

  // VPC Resources
  public vpc: ec2.Vpc;
  public rdsDbSg: ec2.SecurityGroup;
  public bastionHost: ec2.BastionHostLinux;

  // DB Instance Resources
  public databaseCredentialsSecret: secretsmanager.Secret;
  public databaseCredentialsSecretName: string;
  public databaseInstance: rds.DatabaseInstance;
  public databaseProxyEndpoint: string;

  // Service
  public ecsTaskRole: iam.Role;
  public ecsService: EcsService;

  // CICD Pipeline
  public quickstartPipeline: QuickstartPipeline;

  // Static Site
  public staticSite: StaticSite;

  constructor(
    scope: Construct,
    id: string,
    private readonly props: QuickstartStackProps
  ) {
    super(scope, id, props);

    const { environmentName, hostedZoneDomainName, serviceName, siteName } = props;
    this.id = id;
    this.environmentName = environmentName;
    this.serviceName = serviceName;
    this.siteName = siteName;
    this.hostedZoneDomainName = hostedZoneDomainName;

    this.buildResources();
  }

  buildResources() {
    this.loadHostedZone();
    this.buildVpc();
    this.buildSecurityGroup();
    this.buildBastionHost();
    this.buildDatabaseCredentialsSecret();
    this.buildDatabaseInstance();
    this.buildEcsService();
    this.buildQuickstartPipeline();
    this.buildStaticSite();
  }

  private loadHostedZone() {
    const hostedZoneId = `${this.id}-hostedZone`;
    this.hostedZone = route53.HostedZone.fromLookup(this, hostedZoneId, {
      domainName: this.hostedZoneDomainName,
      privateZone: false,
    });
  }

  buildVpc() {
    const vpcId = `${this.id}-vpc`;
    this.vpc = new ec2.Vpc(this, vpcId, {
      enableDnsHostnames: true,
      enableDnsSupport: true,
      flowLogs: {
        S3Flowlogs: {
          destination: ec2.FlowLogDestination.toS3(),
        },
      },
      maxAzs: this.props.maxAzs || 2,
      gatewayEndpoints: {
        S3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
      },
    });
    this.vpc.addInterfaceEndpoint(`${vpcId}-endpoint-ecr-docker`, {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
    });
    this.vpc.addInterfaceEndpoint(`${vpcId}-endpoint-ecr`, {
      service: ec2.InterfaceVpcEndpointAwsService.ECR,
    });
    this.vpc.addInterfaceEndpoint(`${vpcId}-endpoint-logs`, {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
    });
    this.vpc.addInterfaceEndpoint(`${vpcId}-endpoint-secrets-manager`, {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
    });
    this.vpc.addInterfaceEndpoint(`${vpcId}-endpoint-ssm`, {
      service: ec2.InterfaceVpcEndpointAwsService.SSM,
    });
  }

  buildSecurityGroup() {
    const rdsDbSgId = `${this.id}-rds-db-sg`;
    this.rdsDbSg = new ec2.SecurityGroup(this, rdsDbSgId, {
      vpc: this.vpc,
    });

    this.rdsDbSg.addIngressRule(
      this.rdsDbSg,
      ec2.Port.tcp(5432),
      'Allow connections to RDS DB from application'
    );

    const vpcOutputId = `output-vpc-id`;
    new CfnOutput(this, vpcOutputId, {
      value: this.vpc.vpcId,
      exportName: `${this.id}-${vpcOutputId}`,
    });
  }

  buildBastionHost() {
    const bastionHostId = `${this.id}-bastion-host`;
    this.bastionHost = new ec2.BastionHostLinux(this, bastionHostId, {
      vpc: this.vpc,
      instanceName: bastionHostId,
      subnetSelection: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      securityGroup: this.rdsDbSg,
    });

    this.bastionHost.allowSshAccessFrom(ec2.Peer.anyIpv4());

    const bastionHostnameOutputId = `output-bastion-hostname`;
    new CfnOutput(this, bastionHostnameOutputId, {
      value: this.bastionHost.instancePublicDnsName,
      exportName: `${this.id}-${bastionHostnameOutputId}`,
    });

    const bastionIdOutputId = `output-bastion-id`;
    new CfnOutput(this, bastionIdOutputId, {
      value: this.bastionHost.instanceId,
      exportName: `${this.id}-${bastionIdOutputId}`,
    });
  }

  buildDatabaseCredentialsSecret() {
    this.databaseCredentialsSecretName = `${this.id}-db-secret`;
    this.databaseCredentialsSecret = new secretsmanager.Secret(
      this,
      this.databaseCredentialsSecretName,
      {
        secretName: this.databaseCredentialsSecretName,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({
            username: this.props.databaseUsername || snakeCase(`${this.id}`),
          }),
          excludePunctuation: true,
          includeSpace: false,
          generateStringKey: 'password',
        },
      }
    );

    const dbCredentialsSecretNameOutputId = `db-credentials-secret-name`;
    new CfnOutput(this, dbCredentialsSecretNameOutputId, {
      value: this.databaseCredentialsSecret.secretName,
      exportName: `${this.id}-${dbCredentialsSecretNameOutputId}`,
    });
  }

  buildDatabaseInstance() {
    const databaseInstanceId = `${this.id}-db`;
    this.databaseInstance = new rds.DatabaseInstance(this, databaseInstanceId, {
      deletionProtection: this.props.deletionProtection || false,
      removalPolicy: this.props.removalPolicy || RemovalPolicy.DESTROY,
      databaseName: this.props.defaultDatabaseName || snakeCase(this.id),
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_12,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      instanceIdentifier: `${databaseInstanceId}-id`,
      credentials: rds.Credentials.fromSecret(this.databaseCredentialsSecret),
      vpc: this.vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
      },
      securityGroups: [this.rdsDbSg],
    });

    const rdsDbOutputId = `db-endpoint`;
    new CfnOutput(this, rdsDbOutputId, {
      value: this.databaseInstance.instanceEndpoint.hostname,
      exportName: `${this.id}-${rdsDbOutputId}`,
    });
  }

  buildEcsService() {
    const taskEnvironment = {
      NAME: this.props.serviceName,
      NODE_ENV: this.environmentName,
      ADDRESS: '0.0.0.0',
      PORT: '4000',
      NO_COLOR: 'true',
    };
    const taskSecrets = {
      PGUSER: ecs.Secret.fromSecretsManager(this.databaseCredentialsSecret, 'username'),
      PGPASSWORD: ecs.Secret.fromSecretsManager(
        this.databaseCredentialsSecret,
        'password'
      ),
      PGDATABASE: ecs.Secret.fromSecretsManager(this.databaseCredentialsSecret, 'dbname'),
      PGHOST: ecs.Secret.fromSecretsManager(this.databaseCredentialsSecret, 'host'),
      PGPORT: ecs.Secret.fromSecretsManager(this.databaseCredentialsSecret, 'port'),
    };

    const ecsServiceId = `${this.id}-service`;
    this.ecsService = new EcsService(this, ecsServiceId, {
      environmentName: this.environmentName,
      hostedZoneDomainName: this.hostedZoneDomainName,
      hostedZone: this.hostedZone,
      securityGroup: this.rdsDbSg,
      serviceName: this.serviceName,
      taskEnvironment,
      taskSecrets,
      vpc: this.vpc,
      autoscalingConfig: {
        maxCapacity: 4,
        minCapacity: 1,
        cpuTargetUtilizationPercent: 50,
        ramTargetUtilizationPercent: 50,
      },
    });
  }

  buildQuickstartPipeline() {
    const quickstartPipelineId = `${this.id}-cicd`;
    this.quickstartPipeline = new QuickstartPipeline(this, quickstartPipelineId, {
      cluster: this.ecsService.cluster,
      databaseCredentialsSecretArn: this.databaseCredentialsSecret.secretArn,
      environmentName: this.environmentName,
      repository: this.ecsService.ecrRepository,
      securityGroup: this.rdsDbSg,
      service: this.ecsService,
      vpc: this.vpc,
    });
  }

  buildStaticSite() {
    const staticSiteId = `${this.id}-web`;
    this.staticSite = new StaticSite(this, staticSiteId, {
      siteSubDomain: this.siteName,
      environmentName: this.environmentName,
      hostedZoneDomainName: this.hostedZoneDomainName,
      hostedZone: this.hostedZone,
    });
  }
}
