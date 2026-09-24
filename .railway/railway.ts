import { defineRailway, github, preserve, project, service, volume } from 'railway/iac';

const REGION = 'sfo';
const SINGLE_GATEWAY_SESSION_REPLICAS = 1;
const STATE_VOLUME_SIZE_MB = 500;
const STATE_MOUNT_PATH = '/data';

export default defineRailway(() => {
  const repository = github('klimeryk/pantograph', { checkSuites: false });

  const stateVolume = volume('@pantograph/backend-volume', {
    alerts: { usage: { '80': {}, '95': {}, '100': {} } },
    allowOnlineResize: true,
    region: REGION,
    sizeMB: STATE_VOLUME_SIZE_MB,
  });

  const pantograph = service('@pantograph/backend', {
    source: repository,
    build: {
      builder: 'RAILPACK',
      buildEnvironment: 'V3',
      buildCommand: 'npm run build',
      watchPatterns: [
        '/backend/**',
        '/frontend/**',
        '/shared/**',
        '/package.json',
        '/package-lock.json',
        '/.nvmrc',
      ],
    },
    start: 'npm start',
    healthcheck: '/api/health',
    deploy: { restartPolicyType: 'ON_FAILURE' },
    replicas: { [REGION]: SINGLE_GATEWAY_SESSION_REPLICAS },
    networking: { privateNetworkEndpoint: 'pantographbackend' },
    volumeMounts: { [STATE_MOUNT_PATH]: stateVolume },
    env: {
      HOST: '0.0.0.0',
      STATE_FILE: `${STATE_MOUNT_PATH}/bot-state.json`,
      PUBLIC_URL: 'https://${{RAILWAY_PUBLIC_DOMAIN}}',
      DISCORD_TOKEN: preserve(),
      LOG_LEVEL: preserve(),
    },
  });

  return project('astonishing-smile', {
    resources: [pantograph, stateVolume],
  });
});
