---
layout: home

hero:
  name: "Go Libraries"
  text: "Config. ORM. Logging. Hosting. Messaging. CLI. Codegen."
  tagline: Production-grade building blocks for Go services — layered configuration, a real Unit of Work ORM, Serilog-style structured logging, a hosting framework, a typed messaging bus, a type-safe CLI framework, and a protoc-free protobuf generator.
  actions:
    - theme: brand
      text: Get Started with sconf
      link: /sconf/
    - theme: alt
      text: sorm
      link: /sorm/
    - theme: alt
      text: srog
      link: /srog/
    - theme: alt
      text: shost
      link: /shost/
    - theme: alt
      text: smsg
      link: /smsg/
    - theme: alt
      text: scmd
      link: /scmd/
    - theme: alt
      text: protogen
      link: /protogen/

features:
  - icon: ⚙️
    title: sconf — layered configuration
    details: Configuration modeled after ASP.NET Core's Microsoft.Extensions.Configuration. JSON, YAML, TOML, env vars, CLI args and Vault secrets — merged per key into a single typed struct.
    link: /sconf/
    linkText: Read the docs
  - icon: 🗄️
    title: sorm — ORM with a real Unit of Work
    details: Track entities, mutate plain structs, call SaveChanges once. Type-safe generated queries, relations, migrations, projections and optimistic concurrency for PostgreSQL, MySQL and SQLite.
    link: /sorm/
    linkText: Read the docs
  - icon: 📝
    title: srog — structured logging
    details: Serilog-style message templates on top of zerolog. Zero-allocation hot path, multi-sink fan-out, rotation, ECS and OpenTelemetry output, HTTP and gRPC integrations.
    link: /srog/
    linkText: Read the docs
  - icon: 🧬
    title: shost — hosting framework
    details: Microsoft.Extensions.Hosting for Go. Ordered startup, graceful shutdown with a deadline, restart supervision, readiness gating, HTTP/cron/health adapters and OpenTelemetry — standard library only.
    link: /shost/
    linkText: Read the docs
  - icon: 📨
    title: smsg — typed messaging bus
    details: MassTransit for Go. Typed consumers, envelopes with ids and headers, in-process retry with backoff, dead-lettering — over RabbitMQ, Kafka (franz-go) or fully in-memory in tests. Stdlib-only core.
    link: /smsg/
    linkText: Read the docs
  - icon: ⌨️
    title: scmd — type-safe CLI framework
    details: An answer to cobra's pain points, CommandLineParser-style. Commands are structs with tags, handlers get typed options, no globals or init(). Flags layer over sconf (argv > env > config > default), Value[T] tracks where a value came from, plus completion, man/Markdown docs, flag groups and localization.
    link: /scmd/
    linkText: Read the docs
  - icon: 🔌
    title: protogen — protobuf codegen without protoc
    details: One Go binary that generates messages, gRPC (all streaming), gRPC-gateway and OpenAPI v3 from .proto files. No protoc, no plugins. protovalidate constraints reflected into the schema, ASP.NET-style problem+json errors, per-method roles/permissions with enforcement interceptors, project scaffolding via init.
    link: /protogen/
    linkText: Read the docs
---
