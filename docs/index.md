---
layout: home

hero:
  name: "Go Libraries"
  text: "Config. ORM. Logging. Hosting. Codegen."
  tagline: Production-grade building blocks for Go services — layered configuration, a real Unit of Work ORM, Serilog-style structured logging, a hosting framework, and a protoc-free protobuf generator.
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
  - icon: 🔌
    title: protogen — protobuf codegen without protoc
    details: One Go binary that generates messages, gRPC (all streaming), gRPC-gateway and OpenAPI v3 from .proto files. No protoc, no plugins. protovalidate constraints reflected into the schema, ASP.NET-style problem+json errors.
    link: /protogen/
    linkText: Read the docs
---
