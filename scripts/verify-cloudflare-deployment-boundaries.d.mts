export interface DeploymentBoundaryPaths {
  readonly previewConfigurationPath?: string;
  readonly retentionConfigurationPath?: string;
}

export function verifyDeploymentBoundaries(paths?: DeploymentBoundaryPaths): void;
