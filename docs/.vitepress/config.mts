import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Go Libraries',
  description: 'Documentation for sconf, sorm, srog, shost and protogen — configuration, ORM, structured logging, hosting and protobuf codegen for Go.',
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
          ],
        },
        {
          text: 'Guide',
          items: [
            { text: 'Services and Lifecycle', link: '/shost/services' },
            { text: 'Restart Policies', link: '/shost/restart-policies' },
            { text: 'HTTP Services', link: '/shost/http' },
            { text: 'Cron Jobs', link: '/shost/cron' },
            { text: 'Health Checks', link: '/shost/health' },
            { text: 'Environments', link: '/shost/environments' },
            { text: 'Observability', link: '/shost/observability' },
          ],
        },
        {
          text: 'Reference',
          items: [{ text: 'API Reference', link: '/shost/api' }],
        },
      ],

      '/protogen/': [
        {
          text: 'protogen',
          items: [
            { text: 'Overview', link: '/protogen/' },
            { text: 'Quick Start', link: '/protogen/quick-start' },
          ],
        },
        {
          text: 'Guide',
          items: [
            { text: 'Generators', link: '/protogen/generators' },
            { text: 'Streaming', link: '/protogen/streaming' },
            { text: 'Validation and OpenAPI', link: '/protogen/validation' },
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
