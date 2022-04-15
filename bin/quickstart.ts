#!/usr/bin/env node
import 'source-map-support/register';
import { App, StackProps, Tags } from 'aws-cdk-lib';
import { QuickstartStack } from '../lib/quickstart-stack';
import { snakeCase } from 'change-case';

const {
  CDK_ENV: environmentName = 'dev',
  CDK_DEFAULT_ACCOUNT,
  AWS_DEFAULT_ACCOUNT_ID,
  CDK_DEFAULT_REGION,
  AWS_DEFAULT_REGION,
} = process.env;

const account = CDK_DEFAULT_ACCOUNT || AWS_DEFAULT_ACCOUNT_ID;
const region = CDK_DEFAULT_REGION || AWS_DEFAULT_REGION;

const app = new App();

const quickstartStackProps: StackProps = {
  description: `Summary: This stack is responsible for handling the Quickstart resources.
Deployment: This stack supports deployments to the standard environments. The stack 
can be deployed to a custom environment (e.g. a developer environment) by ensuring 
that the desired environment name (e.g. ${environmentName}) is set in the $CDK_ENV environment 
variable`,
  env: {
    account,
    region,
  },
};

const hostedZoneDomainName = 'team-brackets.com';
const serviceName = 'quickstart';
const siteName = 'qs-web'

const stackId = `${serviceName}-${environmentName}`;
const quickstartStack = new QuickstartStack(app, stackId, {
  ...quickstartStackProps,
  defaultDatabaseName: snakeCase(serviceName),
  environmentName,
  hostedZoneDomainName,
  serviceName,
  siteName,
});

Tags.of(quickstartStack).add('application', serviceName);
Tags.of(quickstartStack).add('stack', serviceName);
Tags.of(quickstartStack).add('environmentName', environmentName);
