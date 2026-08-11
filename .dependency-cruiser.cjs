/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'domain-no-infrastructure',
      comment: 'packages/domain must stay free of infrastructure adapters (hexagonal boundary).',
      severity: 'error',
      from: { path: '^packages/domain' },
      to: { path: '^packages/infrastructure' },
    },
    {
      name: 'domain-no-application',
      comment: 'packages/domain must not depend on use cases; dependencies point inward only.',
      severity: 'error',
      from: { path: '^packages/domain' },
      to: { path: '^packages/application' },
    },
    {
      name: 'domain-no-third-party-runtime-deps',
      comment: 'packages/domain may only depend on type-only npm packages (e.g. @types/*), never runtime libraries.',
      severity: 'error',
      from: { path: '^packages/domain' },
      to: {
        dependencyTypes: ['npm', 'npm-no-pkg'],
        pathNot: ['^node_modules/@types/'],
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.base.json',
    },
    doNotFollow: {
      path: 'node_modules',
    },
    exclude: {
      path: '(^|/)(dist|coverage)(/|$)',
    },
  },
};
