'use strict';

const {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand
} = require('@aws-sdk/client-s3');

function photoS3(env) {
  const { PHOTO_S3_ENDPOINT: endpoint, PHOTO_S3_BUCKET: bucket, PHOTO_S3_REGION: region,
    PHOTO_S3_ACCESS_KEY_ID: accessKeyId, PHOTO_S3_SECRET_ACCESS_KEY: secretAccessKey } = env;
  const settings = [endpoint, bucket, region, accessKeyId, secretAccessKey];
  if (settings.every(value => !value)) return null;
  if (settings.some(value => !value) || new URL(endpoint).protocol !== 'https:') {
    throw new Error('Для S3 нужны HTTPS-адрес, бакет, регион и оба ключа');
  }
  const client = new S3Client({
    endpoint, region, forcePathStyle: true, credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED'
  });

  function send(Command, key, options) {
    return client.send(new Command({ Bucket: bucket, Key: key, ...options }), {
      abortSignal: AbortSignal.timeout(30000)
    });
  }

  return {
    writable: env.PHOTO_S3_WRITE !== '0',
    put: (key, body, type = 'image/jpeg') => send(PutObjectCommand, key, { Body: body, ContentType: type }),
    get: (key, options = {}, head = false) => send(head ? HeadObjectCommand : GetObjectCommand, key, options),
    remove: key => send(DeleteObjectCommand, key)
  };
}

module.exports = { photoS3 };
