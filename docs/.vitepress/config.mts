import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Go Libraries',
  description: 'Documentation for sconf, sorm, srog, shost, smsg, scmd and protogen — configuration, ORM, structured logging, hosting, messaging, CLI framework and protobuf codegen for Go.',
  base: '/docs/',
  lastUpdated: true,
  cleanUrls: true,

  head: [
    ['meta', { name: 'theme-color', content: '#00add8' }],
  ],

  themeConfig: {
    nav: [
      { text: 'sconf', link: '/sconf/', activeMatch: '^/sconf/' },
      { text: 'sorm', link: '/sorm/', activeMatch: '^/sorm/' },
      { text: 'srog', link: '/srog/', activeMatch: '^/srog/' },
      { text: 'shost', link: '/shost/', activeMatch: '^/shost/' },
      { text: 'smsg', link: '/smsg/', activeMatch: '^/smsg/' },
      { text: 'scmd', link: '/scmd/', activeMatch: '^/scmd/' },
      { text: 'protogen', link: '/protogen/', activeMatch: '^/protogen/' },
    ],

    search: {
      provider: 'local',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/dvislobokov' },
    ],

    outline: { level: [2, 3] },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © Denis Vislobokov',
    },

    sidebar: {
      '/sconf/': [
        {
          text: 'sconf',
          items: [
            { text: 'Overview', link: '/sconf/' },
            { text: 'Quick Start', link: '/sconf/quick-start' },
            { text: 'Examples', link: '/sconf/examples' },
          ],
        },
        {
          text: 'Guide',
          items: [
            { text: 'Providers and Layering', link: '/sconf/providers' },
            { text: 'Environment Variables', link: '/sconf/environment-variables' },
            { text: 'Struct Binding', link: '/sconf/binding' },
            { text: 'Usage and Help', link: '/sconf/usage-help' },
            { text: 'Advanced', link: '/sconf/advanced' },
            { text: 'Vault Secrets', link: '/sconf/vault' },
            { text: 'Error Handling', link: '/sconf/errors' },
          ],
        },
        {
          text: 'Reference',
          items: [{ text: 'API Reference', link: '/sconf/api' }],
        },
      ],

      '/sorm/': [
        {
          text: 'sorm',
          items: [
            { text: 'Overview', link: '/sorm/' },
            { text: 'Quick Start', link: '/sorm/quick-start' },
            { text: 'Examples', link: '/sorm/examples' },
          ],
        },
        {
          text: 'Guide',
          items: [
            { text: 'Models', link: '/sorm/models' },
            { text: 'Code Generation', link: '/sorm/codegen' },
            { text: 'Queries', link: '/sorm/queries' },
            { text: 'Sessions and Change Tracking', link: '/sorm/sessions' },
            { text: 'Relations', link: '/sorm/relations' },
            { text: 'Projections and Aggregates', link: '/sorm/projections' },
            { text: 'Migrations', link: '/sorm/migrations' },
            { text: 'Databases', link: '/sorm/databases' },
            { text: 'Observability and Testing', link: '/sorm/observability' },
          ],
        },
        {
          text: 'Reference',
          items: [{ text: 'API Reference', link: '/sorm/api' }],
        },
      ],

      '/srog/': [
        {
          text: 'srog',
          items: [
            { text: 'Overview', link: '/srog/' },
            { text: 'Quick Start', link: '/srog/quick-start' },
            { text: 'Examples', link: '/srog/examples' },
          ],
        },
        {
          text: 'Guide',
          items: [
            { text: 'Message Templates', link: '/srog/message-templates' },
            { text: 'Levels', link: '/srog/levels' },
            { text: 'Enrichment', link: '/srog/enrichment' },
            { text: 'Sinks', link: '/srog/sinks' },
            { text: 'Rotation', link: '/srog/rotation' },
            { text: 'Configuration', link: '/srog/configuration' },
            { text: 'Context', link: '/srog/context' },
            { text: 'Integrations', link: '/srog/integrations' },
            { text: 'Performance', link: '/srog/performance' },
          ],
        },
        {
          text: 'Reference',
          items: [{ text: 'API Reference', link: '/srog/api' }],
        },
      ],

      '/shost/': [
        {
          text: 'shost',
          items: [
            { text: 'Overview', link: '/shost/' },
            { text: 'Quick Start', link: '/shost/quick-start' },
            { text: 'Examples', link: '/shost/examples' },
          ],
        },
        {
          text: 'Guide',
          items: [
            { text: 'Services and Lifecycle', link: '/shost/services' },
            { text: 'Restart Policies', link: '/shost/restart-policies' },
            { text: 'HTTP Services', link: '/shost/http' },
            { text: 'gRPC and grpc-gateway', link: '/shost/grpc' },
            { text: 'Cron Jobs', link: '/shost/cron' },
            { text: 'Health Checks', link: '/shost/health' },
            { text: 'Environments', link: '/shost/environments' },
            { text: 'Running as a Daemon', link: '/shost/daemons' },
            { text: 'Observability', link: '/shost/observability' },
            { text: 'Testing', link: '/shost/testing' },
          ],
        },
        {
          text: 'Reference',
          items: [{ text: 'API Reference', link: '/shost/api' }],
        },
      ],

      '/smsg/': [
        {
          text: 'smsg',
          items: [
            { text: 'Overview', link: '/smsg/' },
            { text: 'Quick Start', link: '/smsg/quick-start' },
            { text: 'Examples', link: '/smsg/examples' },
          ],
        },
        {
          text: 'Guide',
          items: [
            { text: 'Consumers', link: '/smsg/consumers' },
            { text: 'Publishing', link: '/smsg/publishing' },
            { text: 'Retry and Dead-Lettering', link: '/smsg/retry-dlq' },
            { text: 'RabbitMQ Transport', link: '/smsg/rabbit' },
            { text: 'Kafka Transport', link: '/smsg/kafka' },
            { text: 'Testing', link: '/smsg/testing' },
            { text: 'Observability', link: '/smsg/observability' },
          ],
        },
        {
          text: 'Reference',
          items: [{ text: 'API Reference', link: '/smsg/api' }],
        },
      ],

      '/scmd/': [
        {
          text: 'scmd',
          items: [
            { text: 'Overview', link: '/scmd/' },
            { text: 'Quick Start', link: '/scmd/quick-start' },
          ],
        },
        {
          text: 'Guide',
          items: [
            { text: 'Commands', link: '/scmd/commands' },
            { text: 'Tags Reference', link: '/scmd/tags' },
            { text: 'Configuration Layers', link: '/scmd/configuration' },
            { text: 'Completion, Docs, Localization', link: '/scmd/completion-docs' },
            { text: 'Testing', link: '/scmd/testing' },
          ],
        },
        {
          text: 'Reference',
          items: [{ text: 'API Reference', link: '/scmd/api' }],
        },
      ],

      '/protogen/': [
        {
          text: 'protogen',
          items: [
            { text: 'Overview', link: '/protogen/' },
            { text: 'Quick Start', link: '/protogen/quick-start' },
            { text: 'Scaffolding (init)', link: '/protogen/scaffolding' },
          ],
        },
        {
          text: 'Guide',
          items: [
            { text: 'Generators', link: '/protogen/generators' },
            { text: 'Streaming', link: '/protogen/streaming' },
            { text: 'Validation and OpenAPI', link: '/protogen/validation' },
            { text: 'OpenAPI Annotations', link: '/protogen/openapi-annotations' },
            { text: 'Roles and Permissions', link: '/protogen/authz' },
            { text: 'Managed Mode and Monorepos', link: '/protogen/managed-mode' },
            { text: 'Configuration', link: '/protogen/configuration' },
            { text: 'How It Works', link: '/protogen/how-it-works' },
          ],
        },
        {
          text: 'Reference',
          items: [{ text: 'CLI Reference', link: '/protogen/cli' }],
        },
      ],
    },

    editLink: {
      pattern: 'https://github.com/dvislobokov/docs/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
