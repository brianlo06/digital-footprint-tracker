export interface DeploymentBoundaryPaths {
  readonly previewConfigurationPath?: string;
  readonly retentionConfigurationPath?: string;
  readonly verificationDeliveryConfigurationPath?: string;
}

export function verifyDeploymentBoundaries(paths?: DeploymentBoundaryPaths): void;
