#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CdkFargateExampleStack } from '../lib/cdk_fargate_example-stack';
import * as dotenv from 'dotenv';

dotenv.config();

const app = new cdk.App();
new CdkFargateExampleStack(app, 'CdkFargateExampleStack', {
  // デフォルトのリージョンを ap-northeast-1 にする
  // 環境変数の指定があれば、そちらを優先する
  env: { region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1' }
});