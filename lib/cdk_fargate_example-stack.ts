import { Construct } from 'constructs';
import {
  Stack,
  StackProps,
  RemovalPolicy,
  Duration,
  aws_ec2 as ec2,
  aws_ecs as ecs,
  aws_ecr as ecr,
  aws_elasticloadbalancingv2 as elb,
  aws_logs as logs,
  aws_servicediscovery as servicediscovery,
  aws_iam as iam
} from 'aws-cdk-lib';
import { SubnetType } from 'aws-cdk-lib/aws-ec2';

export class CdkFargateExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const prefix = 'cdk-fargate-example'

    const appContainerRepo = new ecr.Repository(this, 'appContainerRepo', {
      repositoryName: `${prefix}-app`,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.MUTABLE
    });

    const vpc = new ec2.Vpc(this, 'Vpc', {
      cidr: '10.0.0.0/16',
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 0,
      subnetConfiguration: [
        {
          cidrMask: 28,
          name: 'public',
          subnetType: SubnetType.PUBLIC,
        },
      ]
    });

    const cluster = new ecs.Cluster(this, 'cluster', {
      vpc: vpc,
    });

    const albSecurityGroup = new ec2.SecurityGroup(this, 'albSecurityGroup', {
      securityGroupName: `${prefix}-alb-security-group`,
      vpc: vpc,
    });
    albSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80));

    const serviceSecurityGroup = new ec2.SecurityGroup(
      this,
      'serviceSecurityGroup',
      {
        securityGroupName: `${prefix}-service-security-group`,
        vpc: vpc,
      }
    );
    serviceSecurityGroup.addIngressRule(
      albSecurityGroup,
      ec2.Port.allTcp()
    );

    const cloudmapNamespace = new servicediscovery.PrivateDnsNamespace(
      this,
      'namespace',
      {
        name: 'cdk.ecs.local',
        vpc: vpc,
      }
    );
    const ecsExecPolicyStatement = new iam.PolicyStatement({
      sid: 'allowECSExec',
      resources: ['*'],
      actions: [
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel',
        'logs:CreateLogStream',
        'logs:DescribeLogGroups',
        'logs:DescribeLogStreams',
        'logs:PutLogEvents',
      ],
    });

    const taskRole = new iam.Role(this, 'taskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    taskRole.addToPolicy(ecsExecPolicyStatement);

    const taskExecutionRole = new iam.Role(this, 'taskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        {
          managedPolicyArn:
            'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
        },
      ],
    });

    const logGroup = new logs.LogGroup(this, 'logGroup', {
      logGroupName: `${prefix}`,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const alb = new elb.ApplicationLoadBalancer(this, 'alb', {
      vpc: vpc,
      internetFacing: true,
      securityGroup: albSecurityGroup,
      vpcSubnets: { subnets: vpc.publicSubnets },
    });

    const taskDefinition = new ecs.FargateTaskDefinition(
      this,
      'taskDefinition',
      {
        memoryLimitMiB: 512,
        cpu: 256,
        executionRole: taskExecutionRole,
        taskRole: taskRole,
      }
    );

    const image = ecs.ContainerImage.fromEcrRepository(
      ecr.Repository.fromRepositoryName(this, 'appImage', `${prefix}-app`)
    );

    taskDefinition.addContainer('container', {
      image: image,
      containerName: 'app',
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: prefix,
        logGroup: logGroup,
      }),
      portMappings: [
        {
          containerPort: 80,
          hostPort: 80,
          protocol: ecs.Protocol.TCP,
        },
      ],
    });

    const fargateService = new ecs.FargateService(
      this,
      'fargateService',
      {
        cluster: cluster,
        desiredCount: 1,
        assignPublicIp: true,
        taskDefinition: taskDefinition,
        enableExecuteCommand: true,
        cloudMapOptions: {
          cloudMapNamespace: cloudmapNamespace,
          containerPort: 80,
          dnsRecordType: servicediscovery.DnsRecordType.A,
          dnsTtl: Duration.seconds(10),
        },
        securityGroups: [serviceSecurityGroup],
      }
    );

    const listener = alb.addListener('albListener', { port: 80 });
    fargateService.registerLoadBalancerTargets(
      {
        containerName: 'app',
        containerPort: 80,
        newTargetGroupId: 'Ecs',
        listener: ecs.ListenerConfig.applicationListener(listener, {
          protocol: elb.ApplicationProtocol.HTTP
        }),
      },
    );
  }
}
