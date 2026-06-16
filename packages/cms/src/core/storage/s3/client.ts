import { AwsClient } from 'aws4fetch';

import type {
  AWSMediaConfig,
  CloudflareMediaConfig,
  CustomMediaConfig,
  DigitalOceanMediaConfig,
  MediaConfig,
  S3Client,
} from '../../types/s3';

import { CMSError } from '../../errors';
import { getAWSHost, getCloudflareHost, getDigitalOceanHost } from './utils';

export function createAWSClient(config: AWSMediaConfig): S3Client {
  const {
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    forcePathStyle = false,
  } = config;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new CMSError('MISSING_REQUIRED_S3_PARAMETERS');
  }

  const host = getAWSHost(region);

  return {
    buildBucketUrl: (bucketName) =>
      `https://${forcePathStyle ? `${host}/${bucketName}` : `${bucketName}.${host}`}`,
    s3: new AwsClient({
      accessKeyId,
      secretAccessKey,
      sessionToken,
      region,
      service: 's3',
      retries: 0,
    }),
  };
}

export function createDigitalOceanClient(
  config: DigitalOceanMediaConfig,
): S3Client {
  const {
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    forcePathStyle = true,
  } = config;

  if (!region || !accessKeyId || !secretAccessKey) {
    throw new CMSError('MISSING_REQUIRED_S3_PARAMETERS');
  }

  const host = getDigitalOceanHost(region);

  return {
    buildBucketUrl: (bucketName) =>
      `https://${forcePathStyle ? `${host}/${bucketName}` : `${bucketName}.${host}`}`,
    s3: new AwsClient({
      accessKeyId,
      secretAccessKey,
      sessionToken,
      region: 'us-east-1',
      service: 's3',
      retries: 0,
    }),
  };
}

export function createCloudflareClient(
  config: CloudflareMediaConfig,
): S3Client {
  const {
    accountId,
    jurisdiction,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    forcePathStyle = true,
  } = config;

  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new CMSError('MISSING_REQUIRED_S3_PARAMETERS');
  }

  const host = getCloudflareHost(accountId, jurisdiction);

  return {
    buildBucketUrl: (bucketName) =>
      `https://${forcePathStyle ? `${host}/${bucketName}` : `${bucketName}.${host}`}`,
    s3: new AwsClient({
      accessKeyId,
      secretAccessKey,
      sessionToken,
      region: 'auto',
      service: 's3',
      retries: 0,
    }),
  };
}

export function createCustomClient(config: CustomMediaConfig): S3Client {
  const {
    hostname,
    region,
    accessKeyId,
    secretAccessKey,
    sessionToken,
    secure = true,
    forcePathStyle = true,
  } = config;

  if (!hostname || !region || !accessKeyId || !secretAccessKey) {
    throw new CMSError('MISSING_REQUIRED_S3_PARAMETERS');
  }

  return {
    buildBucketUrl: (bucketName) =>
      `http${secure ? 's' : ''}://${forcePathStyle ? `${hostname}/${bucketName}` : `${bucketName}.${hostname}`}`,
    s3: new AwsClient({
      accessKeyId,
      secretAccessKey,
      sessionToken,
      region,
      service: 's3',
      retries: 0,
    }),
  };
}

export function createS3Client(config: MediaConfig): S3Client {
  switch (config.provider) {
    case 'aws':
      return createAWSClient(config);
    case 'digitalOcean':
      return createDigitalOceanClient(config);
    case 'cloudflare':
      return createCloudflareClient(config);
    case 'custom':
      return createCustomClient(config);
    default:
      throw new CMSError('UNKNOWN_S3_PROVIDER');
  }
}
