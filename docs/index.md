---
layout: home

hero:
  name: "Go Libraries"
  text: "Configuration. ORM. Logging."
  tagline: Production-grade building blocks for Go services — layered configuration, a real Unit of Work ORM, and Serilog-style structured logging.
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
---
