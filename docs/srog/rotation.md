# Rotation

File sinks rotate by size, by time, or both, with retention and gzip compression. Rotation is configured per sink with the `Rotate` sink option and a `Rotation` struct; under the hood srog layers time-based rotation over [lumberjack](https://gopkg.in/natefinch/lumberjack.v2).

## The Rotation struct

```go
type Rotation struct {
	MaxSizeMB  int      // rotate once the file exceeds this many megabytes (0 = no size trigger)
	MaxBackups int      // keep at most this many rotated files (0 = keep all)
	MaxAgeDays int      // delete rotated files older than this many days (0 = no limit)
	Compress   bool     // gzip rotated files
	LocalTime  bool     // use local time in backup names and rotation boundaries (default UTC)
	Every      Interval // additional time-based cadence: NoInterval, Hourly, Daily
}
```

The zero value performs no rotation. Size and time triggers **compose**: the file rolls over when either fires.

| Field | Trigger / effect |
| --- | --- |
| `MaxSizeMB` | Size trigger. When only time-based rotation is requested, the size cap is effectively unbounded (srog does not let lumberjack impose its implicit 100 MB default) |
| `Every: srog.Hourly` | Rolls at the top of every hour |
| `Every: srog.Daily` | Rolls at midnight (UTC unless `LocalTime`) |
| `MaxBackups` | Retention by count |
| `MaxAgeDays` | Retention by age |
| `Compress` | Rotated files are gzipped in the background |

## Size rotation in action

A warehouse scanner writing ~2.8 MB of events through a 1 MB size cap with 3 backups and compression:

```go
log, err := srog.New(
	srog.WithFile(logPath, srog.Rotate(srog.Rotation{
		MaxSizeMB:  1,    // roll after ~1 MB
		MaxBackups: 3,    // keep at most 3 rotated files
		MaxAgeDays: 7,    // delete rotated files older than a week
		Compress:   true, // gzip rotated files
	})),
	srog.WithTimestamp(false),
)
if err != nil {
	panic(err)
}

payload := strings.Repeat("x", 512)
for i := 0; i < 5000; i++ {
	log.Information("scan {Seq} payload {Payload}", i, payload)
}
log.Close()
```

Directory listing after the run (captured):

```txt
files in log directory:
  scanner-2026-07-13T08-56-05.406.log.gz                           9430 bytes
  scanner-2026-07-13T08-56-05.409.log.gz                           9434 bytes
  scanner-2026-07-13T08-56-05.414.log.gz                           9430 bytes
  scanner.log                                                    422609 bytes
```

The active file keeps the configured name; rotated backups get a timestamp suffix and, with `Compress`, a `.gz` extension. Compression runs on a background goroutine shortly after each rotation.

## Time-based rotation

```go
srog.WithFile("/var/log/app.log", srog.Rotate(srog.Rotation{
	Every:      srog.Daily,
	MaxBackups: 14,
	Compress:   true,
}))
```

srog tracks the period bucket of the active file; the first write after a boundary (hour or day) forces a rotation before the new period's line is written. With `LocalTime: false` (the default) boundaries are computed in UTC.

::: tip
For containerized deployments that ship logs with Fluent Bit or another tailer, prefer `Every: srog.Daily` plus `MaxAgeDays` — predictable file cadence and bounded disk usage.
:::

## From a config file

The same settings are available declaratively (see [Configuration](./configuration.md)):

```json
{
  "sinks": [
    {
      "type": "file",
      "path": "/var/log/app.log",
      "rotation": {
        "maxSizeMB": 100,
        "maxBackups": 10,
        "maxAgeDays": 30,
        "compress": true,
        "every": "daily"
      }
    }
  ]
}
```
