#!/usr/bin/env node
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as cloudfront_origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CfnOutput, Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Environment } from './quickstart-stack';

export interface StaticSiteProps {
  siteSubDomain: string;
  environmentName: Environment;
  hostedZone: route53.IHostedZone;
  hostedZoneDomainName: string;
}

/**
 * Static site infrastructure, which deploys site content to an S3 bucket.
 *
 * The site redirects from HTTP to HTTPS, using a CloudFront distribution,
 * Route53 alias record, and ACM certificate.
 */
export class StaticSite extends Construct {
  public id: string;
  public environmentName: Environment;
  public hostedZone: route53.IHostedZone;
  public hostedZoneDomainName: string;
  public domainName: string;
  public siteBucket: s3.Bucket;
  public bucketDeployment: s3deploy.BucketDeployment;
  public distribution: cloudfront.Distribution;
  public cloudfrontOAI: cloudfront.OriginAccessIdentity;
  public aRecord: route53.ARecord;
  public certificate: acm.DnsValidatedCertificate;

  constructor(parent: Stack, id: string, props: StaticSiteProps) {
    super(parent, id);

    const { siteSubDomain, environmentName, hostedZone, hostedZoneDomainName } = props;
    this.id = id;
    this.environmentName = environmentName;
    this.hostedZone = hostedZone;
    this.hostedZoneDomainName = hostedZoneDomainName;
    this.domainName = `${siteSubDomain}.${this.environmentName}.${this.hostedZoneDomainName}`;

    this.buildResources();
  }

  buildResources() {
    this.buildBucket();
    this.buildCertificate();
    this.buildDistribution();
    this.buildARecord();
    this.buildBucketDeployment();
  }

  private buildBucket() {
    const siteBucketId = `${this.id}-site-bucket`;
    this.siteBucket = new s3.Bucket(this, siteBucketId, {
      bucketName: this.domainName,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      /**
       * The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
       * the new bucket, and it will remain in your account until manually deleted. By setting the policy to
       * DESTROY, cdk destroy will attempt to delete the bucket, but will error if the bucket is not empty.
       */
      removalPolicy: RemovalPolicy.DESTROY, // NOT for production code
      autoDeleteObjects: true, // NOT for production code
    });

    this.cloudfrontOAI = new cloudfront.OriginAccessIdentity(
      this,
      `${this.id}-cloudfront-oai`,
      {
        comment: `OAI for ${this.id}`,
      }
    );

    // Grant access to cloudfront
    this.siteBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.siteBucket.arnForObjects('*')],
        principals: [
          new iam.CanonicalUserPrincipal(
            this.cloudfrontOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId
          ),
        ],
      })
    );
    new CfnOutput(this, 'Bucket', { value: this.siteBucket.bucketName });
  }

  private buildCertificate() {
    const certificateId = `${this.id}-site-certificate`;
    this.certificate = new acm.DnsValidatedCertificate(this, certificateId, {
      domainName: this.domainName,
      hostedZone: this.hostedZone,
      region: 'us-east-1', // Cloudfront only checks this region for certificates.
    });
    new CfnOutput(this, 'Certificate', { value: this.certificate.certificateArn });
  }

  private buildDistribution() {
    const distributionId = `${this.id}-distribution`;
    this.distribution = new cloudfront.Distribution(this, distributionId, {
      certificate: this.certificate,
      defaultRootObject: 'index.html',
      domainNames: [this.domainName],
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 403,
          responsePagePath: '/error.html',
          ttl: Duration.minutes(30),
        },
      ],
      defaultBehavior: {
        origin: new cloudfront_origins.S3Origin(this.siteBucket, {
          originAccessIdentity: this.cloudfrontOAI,
        }),
        compress: true,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
  }

  private buildARecord() {
    const aRecordId = `${this.id}-a-record`;
    this.aRecord = new route53.ARecord(this, aRecordId, {
      recordName: this.domainName,
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(this.distribution)
      ),
      zone: this.hostedZone,
    });
    new CfnOutput(this, 'URL', { value: `https://${this.domainName}` });
  }

  private buildBucketDeployment() {
    const bucketDeploymentId = `${this.id}-bucket-deployment`;
    this.bucketDeployment = new s3deploy.BucketDeployment(this, bucketDeploymentId, {
      sources: [s3deploy.Source.asset('./web/dist')],
      destinationBucket: this.siteBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });
  }
}
